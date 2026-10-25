// Declares where a relay sync keeps each doc's relay cursor and the state the relay holds, and an in-memory store for callers that persist none.

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
