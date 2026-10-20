// Keeps a share session's docs on its relay: batched encrypted puts, catch-up from stored rows, and snapshots that compact them.
import * as Y from "yjs";
import { bytesToHex } from "../../../encoding/index.js";
import type { RelayStoreAnswer } from "../../transport/index.js";
import { systemScheduler } from "../mesh/index.js";
import type { ShareSession } from "../shareSession.js";
import { docIdCache, MESSAGE_KIND } from "../wire/index.js";
import { memoryCursorStore, type RelayCursorStore } from "./relayCursors.js";
import { RELAY_ERROR_CODE } from "../../../relay/index.js";
import { RelayDocLane } from "./relayDocLane.js";
import { RelayDocPuts } from "./relayDocPuts.js";
import { decodeHeld, emptyHeld } from "./relayHeldState.js";
import type { RelaySync, RelaySyncOptions } from "./relaySyncTypes.js";
import { openStored, sealStored, type StoredFrameContext } from "./storedFrames.js";

const LOG_MODULE = "collab.relay";
export const SNAPSHOT_AFTER_PUTS = 500;

// CONTRACT: documents/contracts/relay.md#clients
export function attachRelaySync(session: ShareSession, options: RelaySyncOptions): RelaySync {
  return new RelayDocSync(session, options);
}

class RelayDocSync implements RelaySync {
  private readonly lanes = new Map<string, RelayDocLane>();
  private readonly byDocId = new Map<string, RelayDocLane>();
  private readonly stops: (() => void)[] = [];
  private readonly frames: StoredFrameContext;
  private readonly puts: RelayDocPuts;
  private readonly cursors: RelayCursorStore;
  private queue: Promise<void> = Promise.resolve();

  constructor(private session: ShareSession, private options: RelaySyncOptions) {
    this.frames = { shareId: options.shareId, key: options.contentKey, docIdOf: docIdCache(options.shareId) };
    const { relay, logger, shareId } = options;
    this.puts = new RelayDocPuts({ relay, logger, shareId, scheduler: options.scheduler ?? systemScheduler, seal: (lane, kind, payload) => this.seal(lane, kind, payload) });
    this.cursors = options.cursors ?? memoryCursorStore();
    this.stops.push(
      relay.onStore((answer) => this.enqueue(() => this.answer(answer))),
      relay.onConnection((open) => this.enqueue(() => (open ? this.opened() : this.dropped()))),
      session.onDoc((docKey, doc) => this.hold(docKey, doc, relay.connected)),
    );
    for (const [docKey, doc] of session.docs()) { this.hold(docKey, doc, false); }
    if (relay.connected) { this.enqueue(() => this.opened()); }
  }

  async flush(): Promise<void> {
    await Promise.all([...this.lanes.values()].map((lane) => this.puts.flush(lane)));
  }

  async close(): Promise<void> {
    this.stops.forEach((stop) => stop());
    await this.flush();
    await this.queue;
  }

  /** Answers are handled one at a time, so a cursor is saved only after the rows below it are applied. */
  private enqueue(task: () => Promise<void> | void): void {
    this.queue = this.queue.then(task).catch((error) => void this.options.logger.error(LOG_MODULE, error, { shareId: this.options.shareId }));
  }

  /** A doc opened while the socket is up catches up on its own; the others do when the socket opens. */
  private hold(docKey: string, doc: Y.Doc, catchUpNow: boolean): void {
    const docId = this.frames.docIdOf(docKey);
    const lane = this.restoreLane(docKey, doc, docId);
    this.lanes.set(docKey, lane);
    void docId.then((id) => this.byDocId.set(bytesToHex(id), lane));
    const onUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === this.session.remoteOrigin) { return; }
      lane.pending.push(update);
      lane.cancelFlush ??= this.puts.schedule(lane);
    };
    doc.on("update", onUpdate);
    this.stops.push(() => { doc.off("update", onUpdate); lane.cancelFlush?.(); });
    if (catchUpNow) { this.enqueue(() => this.catchUp(lane)); }
  }

  /** Without a saved held state the cursor says nothing about what the relay lacks, so the lane catches up from cursor 0 once. */
  private restoreLane(docKey: string, doc: Y.Doc, docId: Promise<Uint8Array>): RelayDocLane {
    const cursor = this.cursors.get(docKey) ?? 0;
    const saved = this.cursors.held(docKey);
    const held = saved && decodeHeld(saved);
    if (cursor > 0 && !held) {
      void this.options.logger.log("INFO", LOG_MODULE, "Catching up from the first row, since the state the relay holds is unknown", { docKey, cursor, unreadable: Boolean(saved) });
    }
    return held ? new RelayDocLane(docKey, doc, docId, cursor, held) : new RelayDocLane(docKey, doc, docId, 0, emptyHeld());
  }

  private async opened(): Promise<void> {
    for (const lane of this.lanes.values()) {
      lane.outstanding = [];
      await this.catchUp(lane);
      if (lane.pending.length > 0 && !lane.cancelFlush) { void this.puts.flush(lane); }
    }
  }

  private dropped(): void {
    this.lanes.forEach((lane) => lane.socketDropped());
  }

  /** `from` continues a paged answer; without it the catch-up starts at the lane's cursor. */
  private async catchUp(lane: RelayDocLane, from?: number): Promise<void> {
    if (from === undefined) { lane.startCatchUp(); }
    const cursor = from ?? lane.cursor;
    const doc = bytesToHex(await lane.docId);
    if (this.options.relay.request({ type: "since", doc, cursor })) { lane.outstanding.push({ type: "since" }); }
    else { lane.catching = false; }
  }

  private async answer(answer: RelayStoreAnswer): Promise<void> {
    await Promise.all([...this.lanes.values()].map((lane) => lane.docId));
    const lane = this.byDocId.get(answer.doc ?? "");
    if (!lane) { return; }
    if (answer.type === "stored") {
      await this.apply(lane, answer.frame);
      lane.rowsSinceSnapshot += 1;
      this.advance(lane, answer.cursor);
    } else if (answer.type === "rows") {
      return this.rows(lane, answer);
    } else {
      const request = lane.outstanding.shift();
      if (answer.type === "error") {
        this.logRefusal(lane, answer.code, request?.type);
        if (request?.type === "since") { lane.catching = false; }
      }
      if (request?.type === "snapshot") { lane.rowsSinceSnapshot = 0; }
      if (request?.type === "put" && answer.type === "accepted") { lane.relayHolds(request.update); lane.rowsSinceSnapshot += 1; this.advance(lane, answer.cursor); }
    }
    await this.snapshotIfDue(lane);
  }

  /** A stale snapshot is expected when two clients reach the same cursor, so it is not a failure. */
  private logRefusal(lane: RelayDocLane, code: number, request: string | undefined): void {
    const context = { docKey: lane.docKey, code, request };
    if (request === "snapshot" && code === RELAY_ERROR_CODE.staleSnapshot) {
      void this.options.logger.log("INFO", LOG_MODULE, "The relay holds a newer snapshot than the stale one this device sent", context);
    } else {
      void this.options.logger.log("WARN", LOG_MODULE, "The relay refused a request", context);
    }
  }

  private async rows(lane: RelayDocLane, answer: Extract<RelayStoreAnswer, { type: "rows" }>): Promise<void> {
    lane.outstanding.shift();
    let last = lane.cursor;
    if (answer.snapshot) {
      await this.apply(lane, answer.snapshot.frame);
      lane.rowsSinceSnapshot = 0;
      last = Math.max(last, answer.snapshot.covers);
    }
    for (const item of answer.items) {
      await this.apply(lane, item.frame);
      last = Math.max(last, item.cursor);
    }
    lane.rowsSinceSnapshot += answer.items.length;
    if (answer.more) { return this.catchUp(lane, last); }
    const before = lane.cursor;
    lane.finishCatchUp(last);
    if (lane.cursor !== before) { lane.saveTo(this.cursors); }
    this.putMissing(lane);
    await this.snapshotIfDue(lane);
  }

  private advance(lane: RelayDocLane, cursor: number): void {
    if (lane.advance(cursor)) { lane.saveTo(this.cursors); }
  }

  private async apply(lane: RelayDocLane, bytes: Uint8Array): Promise<void> {
    const update = await openStored(this.frames, lane.docKey, bytes);
    if (!update) {
      void this.options.logger.log("WARN", LOG_MODULE, "Skipped a stored row that does not open", { docKey: lane.docKey });
      return;
    }
    Y.applyUpdate(lane.doc, update, this.session.remoteOrigin);
    lane.relayHolds(update);
  }

  /** After every catch-up, one put of what the relay lacks replaces the pending updates, which covers edits of an earlier process. */
  private putMissing(lane: RelayDocLane): void {
    const update = lane.missing();
    lane.pending = update ? [update] : [];
    if (update) { void this.puts.flush(lane); }
  }

  /** Only a device that saw every row up to `covers` writes the snapshot, so it never drops an edit it lacks. */
  private async snapshotIfDue(lane: RelayDocLane): Promise<void> {
    if (!lane.caughtUp || lane.rowsSinceSnapshot < SNAPSHOT_AFTER_PUTS || lane.outstanding.some((r) => r.type === "snapshot")) { return; }
    if (!this.options.isSnapshotWriter()) { return; }
    const covers = lane.cursor;
    const { doc, frame } = await this.seal(lane, MESSAGE_KIND.syncStep2, Y.encodeStateAsUpdate(lane.doc));
    if (this.options.relay.request({ type: "snapshot", doc, covers, frame })) {
      lane.outstanding.push({ type: "snapshot" });
      void this.options.logger.log("INFO", LOG_MODULE, "Wrote a relay snapshot", { docKey: lane.docKey, covers });
    }
  }

  private async seal(lane: RelayDocLane, kind: typeof MESSAGE_KIND.update | typeof MESSAGE_KIND.syncStep2, payload: Uint8Array) {
    const { docId, message } = await sealStored(this.frames, kind, lane.docKey, payload);
    return { doc: bytesToHex(docId), frame: message };
  }
}
