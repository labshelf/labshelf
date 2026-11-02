// Deck DOM barrel: the sandboxed slide frame of the deck editor (deckFrame) and a lazy loader of the editor itself; not exported from the core root.
export { buildSlideSrcdoc, deckFrameCsp, mountDeckFrame } from "./deckFrame.js";
export type { DeckFrame, DeckFrameOptions, DeckMathLoader } from "./deckFrame.js";

export type { DeckEditorChange, DeckEditorController, DeckEditorOptions, DeckHistoryMode } from "./openDeckEditor.js";

/** Loads the deck editor chunk (`@labshelf/core/deckEditor`) the first time a deck is opened for editing. */
export function loadDeckEditor(): Promise<typeof import("./openDeckEditor.js")> {
  return import("./openDeckEditor.js");
}
