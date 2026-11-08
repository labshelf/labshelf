// The deck editor chunk (`@labshelf/core/deckEditor`): the editor, the deck workspace around it, the presenter, the poster preview and their state.
export type { DeckEditorChange, DeckEditorController, DeckEditorOptions, DeckEditorView, DeckHistoryMode } from "./deckEditorCore.js";
export * from "./openPresenter.js";
export * from "./openPosterPreview.js";
export * from "../presenterState.js"; export * from "../presenterChannel.js";
export { openDeckEditor } from "./deckEditorMount.js";
export * from "./shell/html/index.js";
export * from "../posterMeasure.js";
/** Loads the deck editor chunk (`@labshelf/core/deckEditor`, which also carries the presenter, the poster preview and their state) the first time a deck is opened for editing. */
export const loadDeckEditor = (): Promise<typeof import("./openDeckEditor.js")> => import("./openDeckEditor.js");

