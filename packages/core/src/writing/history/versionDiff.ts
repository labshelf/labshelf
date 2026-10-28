/** Compares two renderings of a paper: pairs the blocks of each side that show the same thing and reports the regions that changed. */
import type { PageArea } from "../../reader/index.js";
import { derivePageBlocks, type PageInk, type PageBox, type BlockLimits } from "./pageBlocks.js";

// --- Block matching ---

/** Darkness summed per cell, and per column of cells. */
interface CellGrid {
  width: number;
  height: number;
  cells: Float32Array;
  columns: Float32Array;
}

// TRAP: the same line set again lands on another sub-pixel phase, which flips anti-aliased edge pixels; pixel-exact
// comparison misses most moved lines on real pdfTeX builds. Cells of 3 px measured under 10% apart for moved lines
// and over 20% for changed ones.
const CELL = 3;
const MAX_DISTANCE = 0.15;
// A changed digit or word is a small share of a whole line but concentrated: the darkest two-cell-wide stripe of
// difference measured at most 0.22 of the line's mean stripe for moved lines and 0.68 for one changed number.
const STRIPE_CELLS = 2;
const MAX_STRIPE_DIFFERENCE = 0.4;

/** Grid of a block whose cells start `px`, `py` pixels before the block. */
function cellGrid(page: PageInk, box: PageBox, px: number, py: number): CellGrid {
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
function closeGrids(a: CellGrid, b: CellGrid, total: number): boolean {
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

/** A block measured for comparison: its cell grid at every pixel phase and its total darkness. */
export interface BlockInput {
  box: PageBox;
  /** Index `py * CELL + px`: the grid starts `px`, `py` pixels before the block. */
  phases: CellGrid[];
  darkness: number;
}

export interface BlockResult {
  pairedBefore: boolean[];
  pairedAfter: boolean[];
}

const CENTER_PHASE = (CELL * CELL - 1) / 2;
const MAX_SIZE_DIFFERENCE = 2;
const MAX_DARKNESS_RATIO = 1.15;
// How far from where the previous pair left off the partner of an unchanged block is looked for first.
const NEAR_BLOCKS = 8;

export function deriveBlockInk(page: PageInk, box: PageBox): BlockInput {
  const phases: CellGrid[] = [];
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) { phases.push(cellGrid(page, box, px, py)); }
  }
  let darkness = 0;
  for (const column of phases[0]!.columns) { darkness += column; }
  return { box, phases, darkness };
}

/** Whether two blocks show the same thing, up to a one-pixel shift and anti-aliasing. */
export function isSameBlock(a: BlockInput, b: BlockInput): boolean {
  if (Math.abs(a.box.width - b.box.width) > MAX_SIZE_DIFFERENCE || Math.abs(a.box.height - b.box.height) > MAX_SIZE_DIFFERENCE) { return false; }
  if (Math.max(a.darkness, b.darkness) > Math.min(a.darkness, b.darkness) * MAX_DARKNESS_RATIO) { return false; }
  // `b` at the middle phase against every phase of `a` covers shifts of a pixel either way.
  const centered = b.phases[CENTER_PHASE]!;
  const total = a.darkness + b.darkness;
  return a.phases.some((grid) => closeGrids(grid, centered, total));
}

/**
 * Walks the `after` rendering in reading order. Each block looks for its partner just after where the previous pair left
 * off, which finds unchanged text at once, and only then anywhere, which finds text an edit moved.
 * @param before blocks in reading order
 * @param after blocks in reading order
 */
export function matchBlocks(before: readonly BlockInput[], after: readonly BlockInput[]): BlockResult {
  const pairedBefore = before.map(() => false);
  const pairedAfter = after.map(() => false);
  const free = (i: number): boolean => i >= 0 && i < before.length && !pairedBefore[i];
  let next = 0;
  after.forEach((block, j) => {
    const partner = nearPartner(next, free, (i) => isSameBlock(before[i]!, block))
      ?? before.findIndex((candidate, i) => free(i) && isSameBlock(candidate, block));
    if (partner < 0) { return; }
    pairedBefore[partner] = pairedAfter[j] = true;
    next = partner + 1;
  });
  return { pairedBefore, pairedAfter };
}

function nearPartner(next: number, free: (i: number) => boolean, same: (i: number) => boolean): number | undefined {
  for (let distance = 0; distance < NEAR_BLOCKS; distance++) {
    for (const i of [next + distance, next - 1 - distance]) {
      if (free(i) && same(i)) { return i; }
    }
  }
  return undefined;
}

// --- Changed regions ---

/** Changed regions in PDF points from each page's top-left corner, as the reader draws them. */
export interface PdfChanges {
  before: PageArea[];
  after: PageArea[];
}

// Narrower than any column gutter; spaces between words never line up into one, whatever their width.
const GUTTER_POINTS = 4;
// About a comma or an accent.
const FRAGMENT_POINTS = 3;
// Changed lines closer than this merge into one region, so a rewritten paragraph is one mark, not one per line.
const MERGE_GAP_POINTS = 6;
const PADDING_POINTS = 1;

interface PlacedBlock extends BlockInput {
  page: number;
}

/**
 * Each side is cut into blocks (lines of each column, figure pieces), and a block is unchanged when the other side
 * has an equal block anywhere in the paper, so text that an edit pushed to another column or page stays unmarked.
 * @param pixelsPerPoint the scale both sides were rendered at
 */
export function comparePdfPages(before: readonly PageInk[], after: readonly PageInk[], pixelsPerPoint: number): PdfChanges {
  const sizes = { gutter: Math.round(GUTTER_POINTS * pixelsPerPoint), fragment: Math.round(FRAGMENT_POINTS * pixelsPerPoint) };
  const beforeBlocks = placedBlocks(before, sizes);
  const afterBlocks = placedBlocks(after, sizes);
  const { pairedBefore, pairedAfter } = matchBlocks(beforeBlocks, afterBlocks);
  return {
    before: changedAreas(beforeBlocks.filter((_, i) => !pairedBefore[i]), pixelsPerPoint),
    after: changedAreas(afterBlocks.filter((_, i) => !pairedAfter[i]), pixelsPerPoint),
  };
}

function placedBlocks(pages: readonly PageInk[], sizes: BlockLimits): PlacedBlock[] {
  return pages.flatMap((page, index) =>
    derivePageBlocks(page, sizes).map((box) => ({ ...deriveBlockInk(page, box), page: index + 1 })));
}

/** Merges neighbouring changed blocks of a page and converts them to points. */
function changedAreas(blocks: readonly PlacedBlock[], pixelsPerPoint: number): PageArea[] {
  const mergeGap = MERGE_GAP_POINTS * pixelsPerPoint;
  const merged: Array<{ page: number; box: PageBox }> = [];
  const ordered = [...blocks].sort((a, b) => a.page - b.page || a.box.y - b.box.y || a.box.x - b.box.x);
  for (const block of ordered) {
    const near = merged.find((area) => area.page === block.page && touches(area.box, block.box, mergeGap));
    if (near) {
      near.box = union(near.box, block.box);
    } else {
      merged.push({ page: block.page, box: block.box });
    }
  }
  return merged.map(({ page, box }) => ({
    page,
    left: Math.max(0, box.x / pixelsPerPoint - PADDING_POINTS),
    top: Math.max(0, box.y / pixelsPerPoint - PADDING_POINTS),
    right: (box.x + box.width) / pixelsPerPoint + PADDING_POINTS,
    bottom: (box.y + box.height) / pixelsPerPoint + PADDING_POINTS,
  }));
}

function touches(a: PageBox, b: PageBox, gap: number): boolean {
  const overlapsHorizontally = a.x < b.x + b.width && b.x < a.x + a.width;
  const verticalGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  return overlapsHorizontally && verticalGap <= gap;
}

function union(a: PageBox, b: PageBox): PageBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
