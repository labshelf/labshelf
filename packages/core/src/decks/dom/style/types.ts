// The port between the Style panel and a deck format: the current style and its block, the block a candidate would write,
// a preview of the current slide in a candidate style, and the one-undo-step write.
import type { DeckStyle } from "../../deckStyleTokens.js";

/** A rendered image of the current slide, or the five colours with a note saying why there is no image. */
export type DeckStylePreview = { kind: "image"; src: string } | { kind: "swatches"; note: string };

export interface DeckStylePort {
  /** The full current style (the block's tokens over DEFAULT_DECK_STYLE) and the block's text, or "" when there is none. */
  read(): { style: DeckStyle; block: string };
  /** The block text `style` would write; null when the style is invalid or cannot be written. */
  candidateBlock(style: DeckStyle): string | null;
  /** The current slide in `style`; may reject. */
  preview(style: DeckStyle): Promise<DeckStylePreview>;
  /** Writes `style` as one undo step; false when the writer could not. */
  apply(style: DeckStyle): boolean;
  /** Shows `style` on the deck's own stage until null; optional (compiled decks have only the card previews). Never records an edit. */
  stagePreview?(style: DeckStyle | null): void;
}
