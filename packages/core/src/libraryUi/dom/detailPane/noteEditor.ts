/**
 * Autosaves the Notes tab: what the user types is kept as a draft and saved after a pause, on blur, before the
 * selection or folder changes and when the page hides. A draft wins over the copy the host echoes back.
 */
import { createDebouncer } from "../../../async/index.js";
import type { PaperRecord } from "../../../model/index.js";
import { writeNote } from "../flows/index.js";
import type { UiContext } from "../uiContext.js";

const SAVE_AFTER_MS = 700;

export interface NoteEditor {
  /** The paper's note as the user sees it: the draft while one exists. */
  text(p: PaperRecord): string;
  changed(id: string, text: string): void;
  /** Saves every draft now. */
  flush(): void;
  dispose(): void;
}

/** `pane` is where the note's state line and the Notes tab live. */
export function createNoteEditor(ctx: UiContext, pane: HTMLElement): NoteEditor {
  const drafts = new Map<string, string>();
  const setState = (text: string): void => {
    const state = pane.querySelector(".note-state");
    if (state) state.textContent = text;
  };
  const flush = (): void => {
    autosave.cancel();
    if (drafts.size === 0) return;
    for (const [id, text] of drafts) writeNote(ctx, id, text);
    drafts.clear();
    setState("Saved");
  };
  const autosave = createDebouncer(flush, SAVE_AFTER_MS);
  const onHide = (): void => { if (document.hidden) flush(); };
  document.addEventListener("visibilitychange", onHide);
  return {
    text: (p) => drafts.get(p.id) ?? p.note ?? "",
    changed(id, text) {
      drafts.set(id, text);
      setState("Editing…");
      autosave.call();
    },
    flush,
    dispose() { flush(); document.removeEventListener("visibilitychange", onHide); },
  };
}
