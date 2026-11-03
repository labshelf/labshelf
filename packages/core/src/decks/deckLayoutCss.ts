// Deck layout CSS: the base layout of a deck size in canvas px and its print CSS in the deck's own unit, shared by the editor frame and the export.
import { deckCanvasPx, formatDeckSize, type DeckSize } from "./deckSizes.js";

/** The sides of a size as formatDeckSize writes them, e.g. ["33.1", "46.8"]. */
function formatSides(size: DeckSize): [string, string] {
  const [w, h] = formatDeckSize(size).slice(0, -size.unit.length).split("x");
  return [w!, h!];
}

/** The block declarations of the properties panel (deckStyle.ts) that its children inherit over the theme's rules for them. */
const TEXT_INHERIT = ["font-family", "font-size", "font-weight", "line-height", "text-align"]
  .map((property) => `[data-block][style*="${property}:"] *{${property}:inherit}`)
  .concat(['[data-block][style^="color:"] *,[data-block][style*=" color:"] *,[data-block][style*=";color:"] *{color:inherit}']);

/** The base layout CSS: slide canvas in px, absolute blocks, hidden notes. Never written into deck.html. */
export function deckBaseCss(size: DeckSize): string {
  const canvas = deckCanvasPx(size);
  // INVARIANT: the canvas keeps its 2 decimals (String drops trailing zeros), so the slide matches the canvas validateDeck checks blocks against.
  const width = String(canvas.width);
  const height = String(canvas.height);
  return [
    "html,body{margin:0;padding:0}",
    `[data-slide]{position:relative;box-sizing:border-box;width:${width}px;height:${height}px;overflow:hidden}`,
    "[data-block]{position:absolute;box-sizing:border-box}",
    "[data-notes]{display:none}",
    // A text style the properties panel wrote on a block reaches its headings and paragraphs, over the theme's own.
    ...TEXT_INHERIT,
  ].join("\n");
}

/** The print CSS: an @page of the deck's own size and unit with no margin, one slide per page. */
export function deckPrintCss(size: DeckSize): string {
  const [w, h] = formatSides(size);
  return `@page{size:${w}${size.unit} ${h}${size.unit};margin:0}\n@media print{[data-slide]{break-after:page}[data-slide]:last-of-type{break-after:auto}}`;
}
