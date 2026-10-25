/** Cuts a page's ink into blocks (single lines of one column, pieces of figures) by recursive XY-cut, in reading order. */
import type { PageInk } from "./pageInk.js";

/** A block's bounding box in pixels of its page's ink map. */
export interface PageBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Sizes in pixels of the page's rendering. */
export interface BlockLimits {
  /** The narrowest column gutter. */
  gutter: number;
  /** Blocks no larger than this either way join their nearest block. */
  fragment: number;
}

// A gutter may be crossed by a few full-width rows (title, wide figures and tables), never by the body text.
const GUTTER_ROW_SHARE = 0.1;

/**
 * Splits at blank rows first, then at blank columns over one of the page's gutters, and repeats on each piece until
 * neither cut applies.
 * @returns the blocks, each trimmed to its ink, in reading order: column by column, top to bottom
 */
export function derivePageBlocks(page: PageInk, sizes: BlockLimits): PageBox[] {
  const gutters = pageGutters(page, sizes.gutter);
  const blocks: PageBox[] = [];
  const pending: PageBox[] = [{ x: 0, y: 0, width: page.width, height: page.height }];
  while (pending.length > 0) {
    const box = trimToInk(page, pending.pop()!);
    if (!box) { continue; }
    const rows = splitRows(page, box);
    const split = rows.length > 1 ? rows : splitAtGutters(page, box, gutters);
    if (split.length > 1) {
      pending.push(...split);
    } else {
      blocks.push(box);
    }
  }
  const column = (box: PageBox): number => gutters.filter(([, to]) => to <= box.x).length;
  return absorbFragments(blocks, sizes.fragment).sort((a, b) => column(a) - column(b) || a.y - b.y || a.x - b.x);
}

/**
 * TRAP: a wide space after a full stop can be as wide as a narrow gutter, and whether it passes a width threshold
 * depends on the sub-pixel phase, so one build would cut the line in two and the next would not. A gutter is instead
 * a stretch of columns blank on almost every inked row of the page, which no space between words is.
 */
function pageGutters(page: PageInk, minWidth: number): Array<[number, number]> {
  const inkRows = new Uint32Array(page.width);
  let rows = 0;
  let first = page.width;
  let last = -1;
  for (let y = 0; y < page.height; y++) {
    const row = y * page.width;
    let inked = false;
    for (let x = 0; x < page.width; x++) {
      if (!page.ink[row + x]) { continue; }
      inkRows[x]!++;
      inked = true;
      first = Math.min(first, x);
      last = Math.max(last, x);
    }
    if (inked) { rows++; }
  }
  const runs = inkRuns(last - first + 1, (dx) => inkRows[first + dx]! > rows * GUTTER_ROW_SHARE, minWidth);
  return runs.slice(1).map(([from], i) => [first + runs[i]![1], first + from]);
}

function rowHasInk(page: PageInk, box: PageBox, y: number): boolean {
  const start = y * page.width + box.x;
  for (let i = start; i < start + box.width; i++) { if (page.ink[i]) { return true; } }
  return false;
}

function columnHasInk(page: PageInk, box: PageBox, x: number): boolean {
  for (let y = box.y; y < box.y + box.height; y++) { if (page.ink[y * page.width + x]) { return true; } }
  return false;
}

function trimToInk(page: PageInk, box: PageBox): PageBox | undefined {
  let top = box.y;
  let bottom = box.y + box.height - 1;
  while (top <= bottom && !rowHasInk(page, box, top)) { top++; }
  if (top > bottom) { return undefined; }
  while (!rowHasInk(page, box, bottom)) { bottom--; }
  const rows = { ...box, y: top, height: bottom - top + 1 };
  let left = box.x;
  let right = box.x + box.width - 1;
  while (!columnHasInk(page, rows, left)) { left++; }
  while (!columnHasInk(page, rows, right)) { right--; }
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** Runs of inked positions along one axis, split wherever at least `minGap` blank positions separate them. */
function inkRuns(length: number, hasInk: (offset: number) => boolean, minGap: number): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  let start = -1;
  let blank = 0;
  for (let offset = 0; offset < length; offset++) {
    if (!hasInk(offset)) { blank++; continue; }
    if (start < 0) {
      start = offset;
    } else if (blank >= minGap) {
      runs.push([start, offset - blank]);
      start = offset;
    }
    blank = 0;
  }
  if (start >= 0) { runs.push([start, length - blank]); }
  return runs;
}

function splitRows(page: PageInk, box: PageBox): PageBox[] {
  return inkRuns(box.height, (dy) => rowHasInk(page, box, box.y + dy), 1)
    .map(([from, to]) => ({ x: box.x, y: box.y + from, width: box.width, height: to - from }));
}

/** Cuts at blank column runs that overlap a gutter; other blank runs are spaces inside a line. */
function splitAtGutters(page: PageInk, box: PageBox, gutters: ReadonlyArray<[number, number]>): PageBox[] {
  const pieces = inkRuns(box.width, (dx) => columnHasInk(page, box, box.x + dx), 1)
    .map(([from, to]) => ({ x: box.x + from, y: box.y, width: to - from, height: box.height }));
  const joined: PageBox[] = [];
  for (const piece of pieces) {
    const previous = joined[joined.length - 1];
    const gapFrom = previous ? previous.x + previous.width : 0;
    if (previous && !gutters.some(([from, to]) => from < piece.x && to > gapFrom)) {
      previous.width = piece.x + piece.width - previous.x;
    } else {
      joined.push({ ...piece });
    }
  }
  return joined;
}

/**
 * TRAP: a comma's tail or an accent can come apart from its line by one anti-aliased row in one build and not the
 * next, so fragments join their nearest block instead of standing alone.
 */
function absorbFragments(blocks: PageBox[], fragment: number): PageBox[] {
  const isFragment = (box: PageBox): boolean => box.width <= fragment && box.height <= fragment;
  const kept = blocks.filter((box) => !isFragment(box));
  for (const piece of blocks.filter(isFragment)) {
    const nearest = kept.reduce<PageBox | undefined>((best, box) => (!best || gap(piece, box) < gap(piece, best) ? box : best), undefined);
    if (!nearest || gap(piece, nearest) > fragment) { kept.push(piece); continue; }
    const x = Math.min(nearest.x, piece.x);
    const y = Math.min(nearest.y, piece.y);
    nearest.width = Math.max(nearest.x + nearest.width, piece.x + piece.width) - x;
    nearest.height = Math.max(nearest.y + nearest.height, piece.y + piece.height) - y;
    nearest.x = x;
    nearest.y = y;
  }
  return kept;
}

function gap(a: PageBox, b: PageBox): number {
  const dx = Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width));
  const dy = Math.max(0, Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height));
  return Math.max(dx, dy);
}
