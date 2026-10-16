/** Finds the regions that changed between two renderings of a paper, on the pages of each side. */
import type { PageArea } from "../../reader/index.js";
import { blockInk, pairBlocks, type BlockInk } from "./blockPairs.js";
import type { InkMap } from "./inkMap.js";
import { pageBlocks, type BlockSizes, type PixelBox } from "./pageBlocks.js";

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

interface PlacedBlock extends BlockInk {
  page: number;
}

/**
 * Each side is cut into blocks (lines of each column, figure pieces), and a block is unchanged when the other side
 * has an equal block anywhere in the paper, so text that an edit pushed to another column or page stays unmarked.
 * @param pixelsPerPoint the scale both sides were rendered at
 */
export function diffPages(before: readonly InkMap[], after: readonly InkMap[], pixelsPerPoint: number): PdfChanges {
  const sizes = { gutter: Math.round(GUTTER_POINTS * pixelsPerPoint), fragment: Math.round(FRAGMENT_POINTS * pixelsPerPoint) };
  const beforeBlocks = placedBlocks(before, sizes);
  const afterBlocks = placedBlocks(after, sizes);
  const { pairedBefore, pairedAfter } = pairBlocks(beforeBlocks, afterBlocks);
  return {
    before: changedAreas(beforeBlocks.filter((_, i) => !pairedBefore[i]), pixelsPerPoint),
    after: changedAreas(afterBlocks.filter((_, i) => !pairedAfter[i]), pixelsPerPoint),
  };
}

function placedBlocks(pages: readonly InkMap[], sizes: BlockSizes): PlacedBlock[] {
  return pages.flatMap((page, index) =>
    pageBlocks(page, sizes).map((box) => ({ ...blockInk(page, box), page: index + 1 })));
}

/** Merges neighbouring changed blocks of a page and converts them to points. */
function changedAreas(blocks: readonly PlacedBlock[], pixelsPerPoint: number): PageArea[] {
  const mergeGap = MERGE_GAP_POINTS * pixelsPerPoint;
  const merged: Array<{ page: number; box: PixelBox }> = [];
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

function touches(a: PixelBox, b: PixelBox, gap: number): boolean {
  const overlapsHorizontally = a.x < b.x + b.width && b.x < a.x + a.width;
  const verticalGap = Math.max(a.y, b.y) - Math.min(a.y + a.height, b.y + b.height);
  return overlapsHorizontally && verticalGap <= gap;
}

function union(a: PixelBox, b: PixelBox): PixelBox {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}
