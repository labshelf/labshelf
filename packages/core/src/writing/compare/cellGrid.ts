/** Sums a block's darkness over a coarse grid and decides whether two grids show the same thing. */
import type { InkMap } from "./inkMap.js";
import type { PixelBox } from "./pageBlocks.js";

/** Darkness summed per cell, and per column of cells. */
export interface CellGrid {
  width: number;
  height: number;
  cells: Float32Array;
  columns: Float32Array;
}

// TRAP: the same line set again lands on another sub-pixel phase, which flips anti-aliased edge pixels; pixel-exact
// comparison misses most moved lines on real pdfTeX builds. Cells of 3 px measured under 10% apart for moved lines
// and over 20% for changed ones.
export const CELL = 3;
const MAX_DISTANCE = 0.15;
// A changed digit or word is a small share of a whole line but concentrated: the darkest two-cell-wide stripe of
// difference measured at most 0.22 of the line's mean stripe for moved lines and 0.68 for one changed number.
const STRIPE_CELLS = 2;
const MAX_STRIPE_DIFFERENCE = 0.4;

/** Grid of a block whose cells start `px`, `py` pixels before the block. */
export function cellGrid(page: InkMap, box: PixelBox, px: number, py: number): CellGrid {
  const width = Math.ceil((box.width + px) / CELL);
  const height = Math.ceil((box.height + py) / CELL);
  const cells = new Float32Array(width * height);
  const columns = new Float32Array(width);
  for (let y = 0; y < box.height; y++) {
    const row = (box.y + y) * page.width + box.x;
    const cellRow = Math.floor((y + py) / CELL) * width;
    for (let x = 0, column = 0, inCell = px; x < box.width; x++) {
      const dark = page.dark[row + x]!;
      cells[cellRow + column]! += dark;
      columns[column]! += dark;
      if (++inCell === CELL) { inCell = 0; column++; }
    }
  }
  return { width, height, cells, columns };
}

/**
 * Little difference overall and none concentrated in one stripe, cells outside a grid counting as white.
 * @param total both blocks' darkness, which the limits are shares of
 */
export function closeGrids(a: CellGrid, b: CellGrid, total: number): boolean {
  const width = Math.max(a.width, b.width);
  // The column sums bound the cell differences from below, so this cheap pass rejects most pairs exactly.
  if (!withinLimits(columnDifferences(a.columns, b.columns, width), total)) { return false; }
  const height = Math.max(a.height, b.height);
  const columns = new Float32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const va = x < a.width && y < a.height ? a.cells[y * a.width + x]! : 0;
      const vb = x < b.width && y < b.height ? b.cells[y * b.width + x]! : 0;
      columns[x]! += Math.abs(va - vb);
    }
  }
  return withinLimits(columns, total);
}

function columnDifferences(a: Float32Array, b: Float32Array, width: number): Float32Array {
  const differences = new Float32Array(width);
  for (let x = 0; x < width; x++) { differences[x] = Math.abs((a[x] ?? 0) - (b[x] ?? 0)); }
  return differences;
}

function withinLimits(differences: Float32Array, total: number): boolean {
  let distance = 0;
  for (const difference of differences) { distance += difference; }
  if (distance > MAX_DISTANCE * total) { return false; }
  const stripeLimit = MAX_STRIPE_DIFFERENCE * (total / differences.length) * STRIPE_CELLS;
  for (let x = 0; x + STRIPE_CELLS <= differences.length; x++) {
    let stripe = 0;
    for (let k = 0; k < STRIPE_CELLS; k++) { stripe += differences[x + k]!; }
    if (stripe > stripeLimit) { return false; }
  }
  return true;
}
