// New-slide layouts of an HTML deck: the section a layout writes, its text blocks placed by grid cells of the theme's layout grid,
// or by px rects of the canvas when the grid is too small for the layout.
import { textBlockHtml } from "./deckBlocks.js";
import { deckCellClasses } from "./deckCells.js";
import { escapeAttribute } from "./deckCharts.js";
import { deckGridFromTheme, type DeckCell } from "./deckGrid.js";
import type { DeckModel, DeckRect } from "./deckParse.js";

export type DeckSlideLayout = "title" | "title-text" | "two-columns" | "blank";

/** The layouts in menu order with their labels. */
export const DECK_SLIDE_LAYOUTS: ReadonlyArray<readonly [DeckSlideLayout, string]> = [["title", "Title"], ["title-text", "Title and text"], ["two-columns", "Two columns"], ["blank", "Blank"]];

type Canvas = { width: number; height: number };
/** A block of a layout: its id prefix, its text, and its cell (null when the grid is too small) or px rect. */
interface LayoutBlock { prefix: "title" | "text"; text: string; cell: DeckCell | null; rect: DeckRect }

/** The px rects of the layouts on `canvas`, used when the grid is too small. */
function pxRects(canvas: Canvas): { head: DeckRect; centred: DeckRect; body: DeckRect; left: DeckRect; right: DeckRect } {
  const { width, height } = canvas;
  const m = Math.round(width * 0.06);
  const head = { left: m, top: Math.round(height * 0.08), width: width - 2 * m, height: Math.round(height * 0.14) };
  const bodyTop = head.top + head.height + Math.round(height * 0.04);
  const body = { left: m, top: bodyTop, width: width - 2 * m, height: height - bodyTop - Math.round(height * 0.08) };
  const half = (side: 0 | 1): DeckRect => ({ ...body, left: m + side * Math.round(body.width / 2 + m / 4), width: Math.round(body.width / 2 - m / 4) });
  return { head, centred: { ...head, top: Math.round(height * 0.4) }, body, left: half(0), right: half(1) };
}

/** The blocks of `layout` on a grid of `columns` × `rows`, by cells when the grid is large enough for it. */
function layoutBlocks(layout: DeckSlideLayout, columns: number, rows: number, canvas: Canvas): LayoutBlock[] {
  const rect = pxRects(canvas);
  if (layout === "blank") return [];
  if (layout === "title") {
    const cell = { col: columns >= 3 ? 2 : 1, row: Math.ceil(rows / 2), span: columns >= 3 ? columns - 2 : columns, rows: 1 };
    return [{ prefix: "title", text: "Title", cell, rect: rect.centred }];
  }
  const cells = rows >= 2 && (layout === "title-text" || columns >= 2);
  const title: LayoutBlock = { prefix: "title", text: "Title", cell: cells ? { col: 1, row: 1, span: columns, rows: 1 } : null, rect: rect.head };
  if (layout === "title-text") return [title, { prefix: "text", text: "Text", cell: cells ? { col: 1, row: 2, span: columns, rows: rows - 1 } : null, rect: rect.body }];
  const half = Math.floor(columns / 2);
  return [
    title,
    { prefix: "text", text: "Left column", cell: cells ? { col: 1, row: 2, span: half, rows: rows - 1 } : null, rect: rect.left },
    { prefix: "text", text: "Right column", cell: cells ? { col: half + 1, row: 2, span: columns - half, rows: rows - 1 } : null, rect: rect.right },
  ];
}

/**
 * The section of a new slide of `layout`: its text blocks placed by cell classes of the theme's layout grid (px rects of `canvas` on a grid too small),
 * their ids free in `model` (title-n, text-n).
 */
export function deckSlideLayoutHtml(model: DeckModel | undefined, layout: DeckSlideLayout, theme: string, canvas: { width: number; height: number }): string {
  const grid = deckGridFromTheme(theme, canvas);
  const taken = new Set(model?.slides.flatMap((slide) => slide.blocks.map((block) => block.id)) ?? []);
  const id = (prefix: string): string => {
    let n = 1;
    while (taken.has(`${prefix}-${n}`)) n++;
    taken.add(`${prefix}-${n}`);
    return `${prefix}-${n}`;
  };
  const blocks = layoutBlocks(layout, grid.columns, grid.rows, canvas).map((block) => {
    const blockId = id(block.prefix);
    return block.cell ? `<div data-block="${blockId}" class="${deckCellClasses(block.cell)}"><p>${escapeAttribute(block.text)}</p></div>` : textBlockHtml(blockId, block.rect, block.text);
  });
  return `<section data-slide>\n  ${blocks.join("\n  ")}\n</section>`;
}
