// Binds the fold plugin's state to a host's view-state port (plan D9): loads once on bind, saves debounced after each fold change. Never touches the document.
import type { EditorView } from "prosemirror-view";
import { createDebouncer } from "../../async/index.js";
import { normaliseNoteViewState, type NoteViewState, type QmdViewStatePort } from "../noteViewState.js";
import { foldStateOf, onFoldChange, replaceFold } from "./foldPlugin.js";

const SAVE_DELAY_MS = 300;

/**
 * Applies the port's value for `viewState.key` to the fold plugin of `view` (keys not in the body are ignored; nothing is saved for the load),
 * then saves the fold state under that key 300 ms after each change. The returned function flushes a pending save and unbinds.
 */
export function bindFoldViewState(view: EditorView, viewState: { port: QmdViewStatePort; key: string }): () => void {
  const { port, key } = viewState;
  const saved = normaliseNoteViewState(port.load(key));
  if (saved.cells.length > 0 || saved.sections.length > 0 || saved.reading) replaceFold(view, saved);
  const save = createDebouncer(() => {
    if (view.isDestroyed) return;
    const fold = foldStateOf(view.state);
    const state: NoteViewState = { cells: [...fold.cells], sections: [...fold.sections], reading: fold.reading };
    port.save(key, state);
  }, SAVE_DELAY_MS);
  const stop = onFoldChange(view, () => save.call());
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    stop();
    save.flush();
  };
}
