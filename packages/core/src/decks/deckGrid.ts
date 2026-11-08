/**
 * The layout grid of an HTML deck (D3): its columns, rows, margin and gutter in slide px, read from theme.css, the rect of a grid cell and the base CSS that lays cells out.
 */
import type { DeckRect } from "./deckParse.js";

export interface DeckGrid { columns: number; rows: number; margin: number; gutter: number }

/** A grid cell: 1-based column and row, with the number of columns (span) and rows it covers. */
export interface DeckCell { col: number; row: number; span: number; rows: number }

type Canvas = { width: number; height: number };

/** The most columns, rows or span a grid and its cell classes allow. */
export const DECK_GRID_MAX = 24;

const round2 = (value: number): number => {
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export function defaultDeckGrid(canvas: { width: number; height: number }): DeckGrid {
  return { columns: 12, rows: 6, margin: Math.round(canvas.width / 24), gutter: Math.round(canvas.width / 64) };
}

/** The value of the first declaration of a custom property in CSS without comments, or null. */
function firstDeclaration(css: string, name: string): string | null {
  const match = new RegExp(`(?<![\\w-])${name}\\s*:([^;}]*)`).exec(css);
  return match ? match[1]!.trim() : null;
}

function readCount(css: string, name: string): number | null {
  const value = firstDeclaration(css, name);
  if (value === null || !/^\d+$/.test(value)) return null;
  const count = Number(value);
  return count >= 1 && count <= DECK_GRID_MAX ? count : null;
}

function readPx(css: string, name: string): number | null {
  const value = firstDeclaration(css, name);
  const match = value === null ? null : /^(\d+(?:\.\d+)?)px$/.exec(value);
  return match ? Number(match[1]) : null;
}

/** Reads --deck-grid-columns, --deck-grid-rows, --deck-grid-margin and --deck-grid-gutter; a missing or invalid one takes its default. */
export function deckGridFromTheme(theme: string, canvas: { width: number; height: number }): DeckGrid {
  const css = theme.replace(/\/\*[\s\S]*?(\*\/|$)/g, " ");
  const fallback = defaultDeckGrid(canvas);
  return {
    columns: readCount(css, "--deck-grid-columns") ?? fallback.columns,
    rows: readCount(css, "--deck-grid-rows") ?? fallback.rows,
    margin: readPx(css, "--deck-grid-margin") ?? fallback.margin,
    gutter: readPx(css, "--deck-grid-gutter") ?? fallback.gutter,
  };
}

/** Whether the cell has whole numbers from 1 and fits inside the grid. */
export function deckCellFits(cell: DeckCell, grid: DeckGrid): boolean {
  const whole = [cell.col, cell.row, cell.span, cell.rows].every((value) => Number.isInteger(value) && value >= 1);
  return whole && cell.col + cell.span - 1 <= grid.columns && cell.row + cell.rows - 1 <= grid.rows;
}

/** The size of one column and one row. */
function trackSizes(grid: DeckGrid, canvas: Canvas): { cw: number; rh: number } {
  return {
    cw: (canvas.width - 2 * grid.margin - (grid.columns - 1) * grid.gutter) / grid.columns,
    rh: (canvas.height - 2 * grid.margin - (grid.rows - 1) * grid.gutter) / grid.rows,
  };
}

/** Start and length of `count` tracks from track `index` (1-based). */
const track = (index: number, count: number, size: number, grid: DeckGrid): [number, number] => [grid.margin + (index - 1) * (size + grid.gutter), count * size + (count - 1) * grid.gutter];

export function deckCellRect(cell: DeckCell, grid: DeckGrid, canvas: { width: number; height: number }): DeckRect {
  const { cw, rh } = trackSizes(grid, canvas);
  const [left, width] = track(cell.col, cell.span, cw, grid);
  const [top, height] = track(cell.row, cell.rows, rh, grid);
  return { left: round2(left), top: round2(top), width: round2(width), height: round2(height) };
}

const EPSILON = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= 0.5 + EPSILON;

/** The first index and count of tracks whose start and length match within 0.5 px, or null. */
function matchTrack(start: number, length: number, total: number, size: number, grid: DeckGrid): [number, number] | null {
  for (let index = 1; index <= total; index++) {
    for (let count = 1; index + count - 1 <= total; count++) {
      const [from, extent] = track(index, count, size, grid);
      if (near(round2(from), start) && near(round2(extent), length)) return [index, count];
    }
  }
  return null;
}

/** The cell whose rect matches left, top, width and height within 0.5 px, or null. */
export function deckRectCell(rect: DeckRect, grid: DeckGrid, canvas: { width: number; height: number }): DeckCell | null {
  const { cw, rh } = trackSizes(grid, canvas);
  const x = matchTrack(rect.left, rect.width, grid.columns, cw, grid);
  const y = x && matchTrack(rect.top, rect.height, grid.rows, rh, grid);
  return x && y ? { col: x[0], span: x[1], row: y[0], rows: y[1] } : null;
}

function lines(total: number, size: number, grid: DeckGrid): number[] {
  const values = new Set<number>();
  for (let index = 1; index <= total; index++) {
    const [from, extent] = track(index, 1, size, grid);
    values.add(round2(from));
    values.add(round2(from + extent));
  }
  return [...values].sort((a, b) => a - b);
}

/** The sorted, de-duplicated starts and ends of the columns (x) and rows (y). */
export function deckGridLines(grid: DeckGrid, canvas: { width: number; height: number }): { x: number[]; y: number[] } {
  const { cw, rh } = trackSizes(grid, canvas);
  return { x: lines(grid.columns, cw, grid), y: lines(grid.rows, rh, grid) };
}

/** The CSS of track size: (100% - 2 margin - (count - 1) gutter) / count. */
const trackCss = (count: string): string => `((100% - 2 * var(--deck-grid-margin) - (var(${count}) - 1) * var(--deck-grid-gutter)) / var(${count}))`;

/** The rules that lay out the col-N, span-N, row-N and rows-N classes of a block, N from 1 to 24, over the --deck-grid-* variables. */
export function deckGridCss(): string {
  const cw = trackCss("--deck-grid-columns");
  const rh = trackCss("--deck-grid-rows");
  const rules: string[] = [];
  for (let n = 1; n <= DECK_GRID_MAX; n++) {
    rules.push(
      `[data-block].col-${n}{left:calc(var(--deck-grid-margin) + ${n - 1} * (${cw} + var(--deck-grid-gutter)))}`,
      `[data-block].span-${n}{width:calc(${n} * ${cw} + ${n - 1} * var(--deck-grid-gutter))}`,
      `[data-block].row-${n}{top:calc(var(--deck-grid-margin) + ${n - 1} * (${rh} + var(--deck-grid-gutter)))}`,
      `[data-block].rows-${n}{height:calc(${n} * ${rh} + ${n - 1} * var(--deck-grid-gutter))}`,
    );
  }
  return rules.join("\n");
}
