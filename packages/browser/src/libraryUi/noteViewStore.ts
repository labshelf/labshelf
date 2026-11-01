// Keeps how notes are shown (collapsed cells and sections, Reading mode) in localStorage, one JSON value per note item.
import type { NoteViewState, QmdViewStatePort } from "@labshelf/core";

const PREFIX = "labshelf.noteView.";

/** Stores each key's state as JSON under `labshelf.noteView.<key>`; a storage error or bad JSON is swallowed, so the view works without persistence. */
export function createLocalNoteViewStore(storage: Pick<Storage, "getItem" | "setItem">): QmdViewStatePort {
  return {
    load: (key) => {
      try {
        const raw = storage.getItem(PREFIX + key);
        return raw === null ? undefined : (JSON.parse(raw) as unknown);
      } catch { return undefined; }
    },
    save: (key: string, state: NoteViewState) => {
      try { storage.setItem(PREFIX + key, JSON.stringify(state)); } catch { /* storage unavailable or full: the view keeps its in-memory state */ }
    },
  };
}
