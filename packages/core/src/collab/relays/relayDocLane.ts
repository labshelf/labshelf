// Holds one doc's relay state: local updates waiting for a put, requests awaiting an answer, the cursor it holds rows up to and the state the relay holds.
import * as Y from "yjs";
import type { RelayCursorStore } from "./relayCursors.js";
import { addHeldUpdate, deriveMissingUpdate } from "./relayHeldState.js";

/** The relay answers each store request of a doc in order, so answers match these first in, first out. */
export type OutstandingRequest = { type: "put"; update: Uint8Array } | { type: "since" } | { type: "snapshot" };

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
