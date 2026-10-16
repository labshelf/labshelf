/**
 * @jest-environment jsdom
 */
// Tests the conversion of annotation rectangles and on-screen rectangles into top-left page areas.
import { rectArea, screenArea } from "../../../../../src/reader/dom/hover/citations/pageAreas";
import type { PageViewportLike } from "../../../../../src/reader/dom/navigation";

const HEIGHT = 842;
const viewport: PageViewportLike = {
  viewBox: [0, 0, 595, HEIGHT],
  convertToPdfPoint: (x, y) => [x, HEIGHT - y],
  convertToViewportPoint: (x, y) => [x, HEIGHT - y],
};

describe("rectArea", () => {
  it("flips a bottom-left rectangle to a top-left area", () => {
    expect(rectArea(3, [100, 700, 150, 712], [0, 0, 595, HEIGHT])).toEqual({ page: 3, left: 100, right: 150, top: 130, bottom: 142 });
  });

  it("measures from the view box origin and orders swapped corners", () => {
    expect(rectArea(1, [150, 712, 100, 700], [10, 20, 605, 862])).toEqual({ page: 1, left: 90, right: 140, top: 150, bottom: 162 });
  });
});

describe("screenArea", () => {
  it("converts a client rectangle over a page", () => {
    const pageEl = document.createElement("div");
    pageEl.getBoundingClientRect = () => ({ left: 20, top: 300 }) as DOMRect;
    const rect = { left: 120, top: 350, right: 170, bottom: 362 } as DOMRect;
    expect(screenArea(2, viewport, pageEl, rect)).toEqual({ page: 2, left: 100, right: 150, top: 50, bottom: 62 });
  });
});
