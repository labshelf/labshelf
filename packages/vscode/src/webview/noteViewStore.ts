// Keeps how notes are shown (collapsed cells and sections, Reading mode) in the webview state, which survives a hidden panel and a reload.
import type { NoteViewState, QmdViewStatePort } from "@labshelf/core";

const MAX_KEYS = 200;

/** Stores note view state under `getState().noteView[key]`, merged into the state so every other key survives; keeps the 200 most recently saved keys. */
export function createWebviewNoteViewStore(api: { getState(): unknown; setState(state: unknown): void }): QmdViewStatePort {
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    load: (key) => {
      const noteView = record(record(api.getState())["noteView"]);
      return Object.hasOwn(noteView, key) ? noteView[key] : undefined;
    },
    save: (key: string, state: NoteViewState) => {
      const current = record(api.getState());
      const { [key]: _replaced, ...others } = record(current["noteView"]);
      const kept = Object.entries({ ...others, [key]: state }).slice(-MAX_KEYS);
      api.setState({ ...current, noteView: Object.fromEntries(kept) });
    },
  };
}
