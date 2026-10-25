// Tests cutting a page's ink into blocks in reading order.
import { pageBlocks } from "../../../src/writing/versions/pageBlocks";
import { blankPage, fillRect } from "./inkFixture";

const SIZES = { gutter: 8, fragment: 3 };

describe("pageBlocks", () => {
  it("returns no blocks for a blank page", () => {
    expect(pageBlocks(blankPage(50, 50), SIZES)).toEqual([]);
  });

  it("gives one block per column line and reads the left column before the right", () => {
    const page = blankPage(200, 60);
    for (const y of [10, 30]) {
      fillRect(page, 10, y, 70, 7);
      fillRect(page, 120, y, 70, 7);
    }
    expect(pageBlocks(page, SIZES)).toEqual([
      { x: 10, y: 10, width: 70, height: 7 },
      { x: 10, y: 30, width: 70, height: 7 },
      { x: 120, y: 10, width: 70, height: 7 },
      { x: 120, y: 30, width: 70, height: 7 },
    ]);
  });

  it("does not split a line across a wide blank gap when the page has no gutter", () => {
    const page = blankPage(200, 40);
    fillRect(page, 10, 5, 50, 7);
    fillRect(page, 100, 5, 50, 7);
    fillRect(page, 10, 20, 140, 7);
    expect(pageBlocks(page, SIZES)).toEqual([
      { x: 10, y: 5, width: 140, height: 7 },
      { x: 10, y: 20, width: 140, height: 7 },
    ]);
  });

  it("finds the gutter although a full-width title crosses it", () => {
    const page = blankPage(200, 120);
    fillRect(page, 10, 5, 180, 3);
    for (let i = 0; i < 8; i++) {
      fillRect(page, 10, 20 + i * 12, 70, 5);
      fillRect(page, 120, 20 + i * 12, 70, 5);
    }
    const blocks = pageBlocks(page, SIZES);
    expect(blocks).toHaveLength(17);
    expect(blocks).toContainEqual({ x: 10, y: 5, width: 180, height: 3 });
    expect(blocks.filter((block) => block.width === 70)).toHaveLength(16);
  });

  it("joins a tiny fragment one pixel below a line to that line's box", () => {
    const page = blankPage(100, 40);
    fillRect(page, 10, 10, 70, 7);
    fillRect(page, 30, 18, 2, 2);
    expect(pageBlocks(page, SIZES)).toEqual([{ x: 10, y: 10, width: 70, height: 10 }]);
  });

  it("keeps a fragment far from every block as its own block", () => {
    const page = blankPage(100, 60);
    fillRect(page, 10, 5, 70, 7);
    fillRect(page, 30, 50, 2, 2);
    expect(pageBlocks(page, SIZES)).toEqual([
      { x: 10, y: 5, width: 70, height: 7 },
      { x: 30, y: 50, width: 2, height: 2 },
    ]);
  });
});
