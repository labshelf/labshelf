// Binds the fold plugin's state and the outline flag to a host's view-state port (plan D9, D15): loads once on bind, saves debounced after each change. Never touches the document.
import type { EditorView } from "prosemirror-view";
import { createDebouncer } from "../../async/index.js";
import { normaliseNoteViewState, type NoteViewState, type QmdViewStatePort } from "../noteViewState.js";
import { foldStateOf, onFoldChange, replaceFold } from "./foldPlugin.js";

const SAVE_DELAY_MS = 300;

/** Whether the outline panel is open, per editor view; with its view-state port bound, the save to call after a change. */
const outlineFlags = new WeakMap<EditorView, boolean>();
const savers = new WeakMap<EditorView, () => void>();

/** Whether the outline of the item behind `view` is open (false until set or loaded). */
export function outlineOpenOf(view: EditorView): boolean {
  return outlineFlags.get(view) ?? false;
}

/** Sets whether the outline of the item behind `view` is open, saved through its bound view-state port like the fold state. */
export function setOutlineOpenOf(view: EditorView, open: boolean): void {
  if (outlineOpenOf(view) === open) return;
  outlineFlags.set(view, open);
  savers.get(view)?.();
}

/**
 * Applies the port's value for `viewState.key` to the fold plugin of `view` (keys not in the body are ignored) and to its outline flag; nothing is saved
 * for the load. Then saves the fold state and outline flag under that key 300 ms after each change. The returned function flushes a pending save and unbinds.
 */
export function bindFoldViewState(view: EditorView, viewState: { port: QmdViewStatePort; key: string }): () => void {
  const { port, key } = viewState;
  const saved = normaliseNoteViewState(port.load(key));
  if (saved.cells.length > 0 || saved.sections.length > 0 || saved.reading) replaceFold(view, saved);
  if (saved.outline) outlineFlags.set(view, true);
  const save = createDebouncer(() => {
    if (view.isDestroyed) return;
    const fold = foldStateOf(view.state);
    const state: NoteViewState = { cells: [...fold.cells], sections: [...fold.sections], reading: fold.reading, outline: outlineOpenOf(view) };
    port.save(key, state);
  }, SAVE_DELAY_MS);
  const stop = onFoldChange(view, () => save.call());
  savers.set(view, () => save.call());
  let bound = true;
  return () => {
    if (!bound) return;
    bound = false;
    stop();
    savers.delete(view);
    save.flush();
  };
}
