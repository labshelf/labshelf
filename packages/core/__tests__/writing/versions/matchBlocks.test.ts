// Tests deciding whether two blocks show the same thing and pairing the blocks of two renderings.
import { deriveBlockInk, matchBlocks, isSameBlock } from "../../../src/writing/versions/matchBlocks";
import type { PageBox } from "../../../src/writing/versions/derivePageBlocks";
import { blankPage, fillBars, fillRect } from "./inkFixture";

const BOX: PageBox = { x: 9, y: 4, width: 242, height: 10 };

function barsBlock(options: { x?: number; skipBars?: number[]; dark?: number } = {}) {
  const page = blankPage(260, 20);
  for (let k = 0; k < 60; k++) {
    if (options.skipBars?.includes(k)) { continue; }
    fillRect(page, 10 + (options.x ?? 0) + 4 * k, 5, 2, 8, options.dark ?? 200);
  }
  return deriveBlockInk(page, BOX);
}

/** Eight segments on or off by the bits of `mask`; masks with four bits and a Hamming distance of four never look alike. */
function maskBlock(mask: number) {
  const page = blankPage(40, 8);
  for (let bit = 0; bit < 8; bit++) {
    if (mask & (1 << bit)) { fillRect(page, bit * 5, 0, 5, 8); }
  }
  return deriveBlockInk(page, { x: 0, y: 0, width: 40, height: 8 });
}

const MASKS: number[] = [];
for (let mask = 0; mask < 256 && MASKS.length < 14; mask++) {
  const bits = mask.toString(2).replace(/0/g, "").length;
  const apart = MASKS.every((other) => (mask ^ other).toString(2).replace(/0/g, "").length >= 4);
  if (bits === 4 && apart) { MASKS.push(mask); }
}

describe("isSameBlock", () => {
  it("accepts identical blocks", () => {
    expect(isSameBlock(barsBlock(), barsBlock())).toBe(true);
  });

  it("accepts the same pattern shifted by one pixel", () => {
    expect(isSameBlock(barsBlock(), barsBlock({ x: 1 }))).toBe(true);
  });

  it("rejects a small change concentrated in one place under the global budget", () => {
    expect(isSameBlock(barsBlock(), barsBlock({ skipBars: [20, 21, 22, 23, 24] }))).toBe(false);
  });

  it("rejects a block of very different darkness", () => {
    expect(isSameBlock(barsBlock(), barsBlock({ dark: 100 }))).toBe(false);
  });

  it("rejects blocks of different sizes", () => {
    const wide = blankPage(260, 20);
    fillBars(wide, 10, 5, 100, 8);
    const narrow = blankPage(260, 20);
    fillBars(narrow, 10, 5, 90, 8);
    expect(isSameBlock(deriveBlockInk(wide, { x: 10, y: 5, width: 98, height: 8 }), deriveBlockInk(narrow, { x: 10, y: 5, width: 86, height: 8 }))).toBe(false);
  });
});

describe("matchBlocks", () => {
  it("has enough distinct masks", () => {
    expect(MASKS.length).toBeGreaterThanOrEqual(14);
  });

  it("pairs unchanged sequences fully", () => {
    const blocks = MASKS.slice(0, 5).map(maskBlock);
    const pairs = matchBlocks(blocks, MASKS.slice(0, 5).map(maskBlock));
    expect(pairs.pairedBefore).toEqual([true, true, true, true, true]);
    expect(pairs.pairedAfter).toEqual([true, true, true, true, true]);
  });

  it("leaves an inserted block unpaired on the after side only", () => {
    const [a, b, c, inserted] = MASKS.map(maskBlock);
    const pairs = matchBlocks([a!, b!, c!], [a!, inserted!, b!, c!]);
    expect(pairs.pairedBefore).toEqual([true, true, true]);
    expect(pairs.pairedAfter).toEqual([true, false, true, true]);
  });

  it("leaves a removed block unpaired on the before side only", () => {
    const [a, b, c] = MASKS.map(maskBlock);
    const pairs = matchBlocks([a!, b!, c!], [a!, c!]);
    expect(pairs.pairedBefore).toEqual([true, false, true]);
    expect(pairs.pairedAfter).toEqual([true, true]);
  });

  it("pairs a block moved beyond the near window through the full search", () => {
    const masks = MASKS.slice(0, 12);
    const before = masks.map(maskBlock);
    const after = [...masks.slice(1), masks[0]!].map(maskBlock);
    const pairs = matchBlocks(before, after);
    expect(pairs.pairedBefore.every(Boolean)).toBe(true);
    expect(pairs.pairedAfter.every(Boolean)).toBe(true);
  });

  it("pairs duplicates one to one", () => {
    const [a, b] = MASKS.map(maskBlock);
    const pairs = matchBlocks([a!, a!, b!], [a!, b!]);
    expect(pairs.pairedBefore.filter(Boolean)).toHaveLength(2);
    expect(pairs.pairedBefore[2]).toBe(true);
    expect(pairs.pairedAfter).toEqual([true, true]);
  });

  it("pairs nothing when either side is empty", () => {
    expect(matchBlocks([], [maskBlock(MASKS[0]!)])).toEqual({ pairedBefore: [], pairedAfter: [false] });
    expect(matchBlocks([maskBlock(MASKS[0]!)], [])).toEqual({ pairedBefore: [false], pairedAfter: [] });
  });
});
