// Deck DOM barrel: a lazy loader of the deck editor chunk; not exported from the core root.

/** Loads the deck editor chunk (`@labshelf/core/deckEditor`) the first time a deck is opened for editing. */
export function loadDeckEditor(): Promise<typeof import("./openDeckEditor.js")> {
  return import("./openDeckEditor.js");
}
