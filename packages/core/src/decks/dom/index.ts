// Deck DOM barrel: a lazy loader of the deck editor chunk, presenter mode, the poster preview and their runtime-neutral state; not exported from the core root.
export { openPresenter, type PresenterController, type PresenterOptions } from "./openPresenter.js";
export { openPosterPreview, type PosterPreviewController, type PosterPreviewOptions, type SmallTextFlag } from "./openPosterPreview.js";
export * from "../present/index.js";

/** Loads the deck editor chunk (`@labshelf/core/deckEditor`) the first time a deck is opened for editing. */
export function loadDeckEditor(): Promise<typeof import("./openDeckEditor.js")> {
  return import("./openDeckEditor.js");
}
