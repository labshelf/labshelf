// Holds the per-doc state of a relay sync: the cursor store, the state the relay is known to hold, the doc lane, and the lane's sealed puts.
// CONTRACT: documents/contracts/relay.md#client-obligations
import * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import { MESSAGE_KIND, type SessionScheduler } from "../peer/index.js";
import type { RelayStore } from "./relayTransport.js";

/** The caller persists cursors with the doc state they describe, so a restart asks `since` only for rows it lacks. */
export interface RelayCursorStore {
  get(docKey: string): number | undefined;
  set(docKey: string, cursor: number): void;
  /** The encoded Yjs snapshot the relay is known to hold for the doc; a stale one is safe, since it only makes a put larger. */
  held(docKey: string): Uint8Array | undefined;
  setHeld(docKey: string, snapshot: Uint8Array): void;
}

export function createMemoryCursorStore(): RelayCursorStore {
  const cursors = new Map<string, number>();
  const held = new Map<string, Uint8Array>();
  return {
    get: (docKey) => cursors.get(docKey),
    set: (docKey, cursor) => { cursors.set(docKey, cursor); },
    held: (docKey) => held.get(docKey),
    setHeld: (docKey, snapshot) => { held.set(docKey, snapshot); },
  };
}

export const createEmptyHeld = (): Y.Snapshot => Y.createSnapshot(Y.createDeleteSet(), new Map());

/** Undefined when the saved bytes do not decode, so the caller treats the held state as unknown. */
export function decodeHeld(bytes: Uint8Array): Y.Snapshot | undefined {
  try { return Y.decodeSnapshot(bytes); } catch { return undefined; }
}

/** Grows `held` by an update the relay holds; the delete set stays sorted and merged, as `equalDeleteSets` needs. */
function addHeldUpdate(held: Y.Snapshot, update: Uint8Array): Y.Snapshot {
  const sv = new Map(held.sv);
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVectorFromUpdate(update))) {
    sv.set(client, Math.max(clock, sv.get(client) ?? 0));
  }
  return Y.createSnapshot(Y.mergeDeleteSets([held.ds, Y.decodeUpdate(update).ds]), sv);
}

/** What `doc` holds beyond `expected`, as one update; undefined when nothing. */
function deriveMissingUpdate(doc: Y.Doc, expected: Y.Snapshot): Uint8Array | undefined {
  const local = Y.snapshot(doc);
  const newerClock = [...local.sv].some(([client, clock]) => clock > (expected.sv.get(client) ?? 0));
  // TRAP: a delete adds no clock, so a delete-only edit shows only in the delete set.
  const newerDelete = !Y.equalDeleteSets(Y.mergeDeleteSets([expected.ds, local.ds]), expected.ds);
  if (!newerClock && !newerDelete) { return undefined; }
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(expected.sv));
}

/** The relay answers each store request of a doc in order, so answers match these first in, first out. */
type OutstandingRequest = { type: "put"; update: Uint8Array } | { type: "since" } | { type: "snapshot" };

export class RelayDocLane {
  pending: Uint8Array[] = [];
  outstanding: OutstandingRequest[] = [];
  cancelFlush: (() => void) | undefined;
  /** A `since` is paging; cursors seen meanwhile wait in `seen`, since rows below them may still come. */
  catching = false;
  /** Every row of the doc arrived on this socket, so this device may write a snapshot. */
  caughtUp = false;
  seen = 0;
  /** Rows of the doc stored after its last snapshot that this device saw. */
  rowsSinceSnapshot = 0;

  /** `held` is what the relay is known to hold: rows this device applied and puts the relay accepted. */
  constructor(readonly docKey: string, readonly doc: Y.Doc, readonly docId: Promise<Uint8Array>, public cursor: number, public held: Y.Snapshot) {}

  startCatchUp(): void {
    this.catching = true;
    this.caughtUp = false;
    this.seen = this.cursor;
  }

  relayHolds(update: Uint8Array): void {
    this.held = addHeldUpdate(this.held, update);
  }

  /** What the doc holds beyond the relay's state and the puts in flight, as one update; undefined when nothing. */
  missing(): Uint8Array | undefined {
    const expected = this.outstanding.reduce((state, request) => (request.type === "put" ? addHeldUpdate(state, request.update) : state), this.held);
    return deriveMissingUpdate(this.doc, expected);
  }

  /** Puts sent on a socket that dropped go back to pending, since the relay may never have stored them. */
  socketDropped(): void {
    const unanswered = this.outstanding.flatMap((request) => (request.type === "put" ? [request.update] : []));
    this.pending.unshift(...unanswered);
    this.outstanding = [];
    this.catching = false;
    this.caughtUp = false;
  }

  saveTo(store: RelayCursorStore): void {
    store.set(this.docKey, this.cursor);
    store.setHeld(this.docKey, Y.encodeSnapshot(this.held));
  }

  /** True when the cursor moved and should be persisted. */
  advance(cursor: number): boolean {
    if (this.catching) { this.seen = Math.max(this.seen, cursor); return false; }
    if (cursor <= this.cursor) { return false; }
    this.cursor = cursor;
    return true;
  }

  finishCatchUp(last: number): void {
    this.catching = false;
    this.caughtUp = true;
    this.advance(Math.max(last, this.seen));
  }
}

const LOG_MODULE = "collab.relay";
/** At most one put per doc in this window while the user types; the window's end is also the idle flush. */
export const PUT_INTERVAL_MS = 2000;

interface RelayDocPutsOptions {
  relay: RelayStore;
  shareId: string;
  logger: ILogger;
  scheduler: SessionScheduler;
  seal: (lane: RelayDocLane, kind: typeof MESSAGE_KIND.update, payload: Uint8Array) => Promise<{ doc: string; frame: Uint8Array }>;
}

export class RelayDocPuts {
  constructor(private options: RelayDocPutsOptions) {}

  /** Opens the put window of a lane that has pending updates and none running. */
  schedule(lane: RelayDocLane): () => void {
    return this.options.scheduler.after(PUT_INTERVAL_MS, () => { lane.cancelFlush = undefined; void this.flush(lane); });
  }

  async flush(lane: RelayDocLane): Promise<void> {
    const { relay, logger, shareId } = this.options;
    lane.cancelFlush?.();
    lane.cancelFlush = undefined;
    if (lane.pending.length === 0 || !relay.connected) { return; }
    const update = lane.pending.length === 1 ? lane.pending[0]! : Y.mergeUpdates(lane.pending);
    lane.pending = [];
    // TRAP: sealing takes real time, so updates typed meanwhile wait for a window that starts at the put, not at this call.
    const sealing = () => {};
    lane.cancelFlush = sealing;
    let retryLater = false;
    try {
      const { doc, frame } = await this.options.seal(lane, MESSAGE_KIND.update, update);
      const sent = relay.request({ type: "put", doc, frame });
      if (sent) { lane.outstanding.push({ type: "put", update }); } else { lane.pending.unshift(update); }
      retryLater = sent;
    } catch (error) {
      // The update stays pending, and the next window retries it instead of spinning on a failing key.
      lane.pending.unshift(update);
      retryLater = true;
      void logger.error(LOG_MODULE, error, { shareId, docKey: lane.docKey });
    } finally {
      if (lane.cancelFlush === sealing) { lane.cancelFlush = retryLater && lane.pending.length > 0 ? this.schedule(lane) : undefined; }
    }
  }
}
