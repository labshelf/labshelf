// Deck layout CSS: the base layout of a deck size in canvas px and its print CSS in the deck's own unit, shared by the editor frame and the export.
import { deckGridCss, defaultDeckGrid } from "./deckGrid.js";
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

/** The rules of a sectioned poster's header band and sections: content margin, clipping, figures that keep their caption, and print-sized type from the --poster-font-* variables. */
const POSTER_RULES = [
  "[data-poster]{box-sizing:border-box;padding:var(--poster-content-margin,24px);overflow:hidden;display:flex;flex-direction:column;gap:var(--poster-content-margin,24px)}",
  "[data-poster] figure{margin:0;display:flex;flex-direction:column;min-height:0;flex:1 1 auto}",
  "[data-poster] img{max-width:100%;min-height:0;flex:1 1 auto;object-fit:contain}",
  "[data-poster] h1{font-size:var(--poster-font-title,112px)}",
  "[data-poster] h2{font-size:var(--poster-font-heading,64px)}",
  "[data-poster] p,[data-poster] li{font-size:var(--poster-font-body,42px)}",
  "[data-poster] figcaption{font-size:var(--poster-font-caption,32px)}",
  '[data-poster="header"] p{font-size:var(--poster-font-authors,56px)}',
];

/** The base layout CSS: slide canvas in px, absolute blocks, hidden notes, the poster section rules, the default layout grid of the canvas and its cell rules. Never written into deck.html. */
export function deckBaseCss(size: DeckSize): string {
  const canvas = deckCanvasPx(size);
  // INVARIANT: the canvas keeps its 2 decimals (String drops trailing zeros), so the slide matches the canvas validateDeck checks blocks against.
  const width = String(canvas.width);
  const height = String(canvas.height);
  const grid = defaultDeckGrid(canvas);
  return [
    "html,body{margin:0;padding:0}",
    `[data-slide]{position:relative;box-sizing:border-box;width:${width}px;height:${height}px;overflow:hidden}`,
    "[data-block]{position:absolute;box-sizing:border-box}",
    "[data-notes]{display:none}",
    ...POSTER_RULES,
    // A text style the properties panel wrote on a block reaches its headings and paragraphs, over the theme's own.
    ...TEXT_INHERIT,
    // :where keeps the defaults at zero specificity, so theme.css overrides them whatever the order.
    `:where(:root){--deck-grid-columns:${grid.columns};--deck-grid-rows:${grid.rows};--deck-grid-margin:${grid.margin}px;--deck-grid-gutter:${grid.gutter}px}`,
    deckGridCss(),
  ].join("\n");
}

/** The print CSS: an @page of the deck's own size and unit with no margin, one slide per page. */
export function deckPrintCss(size: DeckSize): string {
  const [w, h] = formatSides(size);
  return `@page{size:${w}${size.unit} ${h}${size.unit};margin:0}\n@media print{[data-slide]{break-after:page}[data-slide]:last-of-type{break-after:auto}}`;
}
