/** Pairs the blocks of two renderings of a paper that show the same thing; an unpaired block is a change. */
import { CELL, cellGrid, closeGrids, type CellGrid } from "./cellGrid.js";
import type { InkMap } from "./inkMap.js";
import type { PixelBox } from "./pageBlocks.js";

/** A block measured for comparison: its cell grid at every pixel phase and its total darkness. */
export interface BlockInk {
  box: PixelBox;
  /** Index `py * CELL + px`: the grid starts `px`, `py` pixels before the block. */
  phases: CellGrid[];
  darkness: number;
}

export interface BlockPairs {
  pairedBefore: boolean[];
  pairedAfter: boolean[];
}

const CENTER_PHASE = (CELL * CELL - 1) / 2;
const MAX_SIZE_DIFFERENCE = 2;
const MAX_DARKNESS_RATIO = 1.15;
// How far from where the previous pair left off the partner of an unchanged block is looked for first.
const NEAR_BLOCKS = 8;

export function blockInk(page: InkMap, box: PixelBox): BlockInk {
  const phases: CellGrid[] = [];
  for (let py = 0; py < CELL; py++) {
    for (let px = 0; px < CELL; px++) { phases.push(cellGrid(page, box, px, py)); }
  }
  let darkness = 0;
  for (const column of phases[0]!.columns) { darkness += column; }
  return { box, phases, darkness };
}

/** Whether two blocks show the same thing, up to a one-pixel shift and anti-aliasing. */
export function sameBlock(a: BlockInk, b: BlockInk): boolean {
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
export function pairBlocks(before: readonly BlockInk[], after: readonly BlockInk[]): BlockPairs {
  const pairedBefore = before.map(() => false);
  const pairedAfter = after.map(() => false);
  const free = (i: number): boolean => i >= 0 && i < before.length && !pairedBefore[i];
  let next = 0;
  after.forEach((block, j) => {
    const partner = nearPartner(next, free, (i) => sameBlock(before[i]!, block))
      ?? before.findIndex((candidate, i) => free(i) && sameBlock(candidate, block));
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
