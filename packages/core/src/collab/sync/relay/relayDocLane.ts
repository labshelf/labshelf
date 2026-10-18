// Holds one doc's relay state: local updates waiting for a put, requests awaiting an answer, and the cursor it holds rows up to.
import type * as Y from "yjs";

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
  /** The Yjs clocks the relay holds, gathered while catching up from cursor 0. */
  relayVector: Map<number, number> | undefined;

  constructor(readonly docKey: string, readonly doc: Y.Doc, readonly docId: Promise<Uint8Array>, public cursor: number) {}

  startCatchUp(): void {
    this.catching = true;
    this.caughtUp = false;
    this.seen = this.cursor;
    this.relayVector = this.cursor === 0 ? new Map() : undefined;
  }

  /** Puts sent on a socket that dropped go back to pending, since the relay may never have stored them. */
  socketDropped(): void {
    const unanswered = this.outstanding.flatMap((request) => (request.type === "put" ? [request.update] : []));
    this.pending.unshift(...unanswered);
    this.outstanding = [];
    this.catching = false;
    this.caughtUp = false;
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
