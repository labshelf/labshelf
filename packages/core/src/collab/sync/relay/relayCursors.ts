// Declares where a relay sync keeps the last relay cursor of each doc, and an in-memory store for callers that persist none.

/** The caller persists cursors with the doc state they describe, so a restart asks `since` only for rows it lacks. */
export interface RelayCursorStore {
  get(docKey: string): number | undefined;
  set(docKey: string, cursor: number): void;
}

export function memoryCursorStore(): RelayCursorStore {
  const cursors = new Map<string, number>();
  return { get: (docKey) => cursors.get(docKey), set: (docKey, cursor) => { cursors.set(docKey, cursor); } };
}
