// Deck editor undo and redo (D8): a bounded history of (deck, theme) snapshots, one per gesture.
export interface DeckSnapshot { html: string; theme: string }

export interface DeckHistory { current(): DeckSnapshot; push(snapshot: DeckSnapshot): void; undo(): DeckSnapshot | undefined; redo(): DeckSnapshot | undefined; canUndo(): boolean; canRedo(): boolean; reset(snapshot: DeckSnapshot): void }

const DEFAULT_LIMIT = 100;

const sameSnapshot = (a: DeckSnapshot, b: DeckSnapshot): boolean => a.html === b.html && a.theme === b.theme;

/** A history holding at most `limit` snapshots (current included); past the limit the oldest is dropped. */
export function createDeckHistory(initial: DeckSnapshot, limit = DEFAULT_LIMIT): DeckHistory {
  const maxPast = Math.max(0, Math.floor(limit) - 1);
  let past: DeckSnapshot[] = [];
  let future: DeckSnapshot[] = [];
  let current = initial;
  return {
    current: () => current,
    push(snapshot) {
      if (sameSnapshot(snapshot, current)) return;
      past.push(current);
      if (past.length > maxPast) past = past.slice(past.length - maxPast);
      future = [];
      current = snapshot;
    },
    undo() {
      const previous = past.pop();
      if (previous === undefined) return undefined;
      future.push(current);
      current = previous;
      return current;
    },
    redo() {
      const next = future.pop();
      if (next === undefined) return undefined;
      past.push(current);
      current = next;
      return current;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    reset(snapshot) {
      past = [];
      future = [];
      current = snapshot;
    },
  };
}
