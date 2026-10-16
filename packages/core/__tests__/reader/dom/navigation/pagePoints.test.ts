// Tests converting between the host's top-left, y-down page points and pdf.js' bottom-left, y-up page space at any scale and rotation.
import { pagePointAt, pixelOffsetOf, type PageViewportLike } from "../../../../src/reader/dom/navigation/pagePoints";

/**
 * Mirrors pdf.js 6.3's PageViewport for rotations 0 and 90, as read from a real A4 page at scale 2:
 * (0, 841.89) maps to (0, 0) at 0 degrees and to (1683.78, 0) at 90 degrees.
 */
function viewport(viewBox: number[], scale: number, rotation: 0 | 90): PageViewportLike {
  const [x0 = 0, y0 = 0, , y1 = 0] = viewBox;
  return rotation === 0
    ? {
        viewBox,
        convertToViewportPoint: (x, y) => [(x - x0) * scale, (y1 - y) * scale],
        convertToPdfPoint: (px, py) => [px / scale + x0, y1 - py / scale],
      }
    : {
        viewBox,
        convertToViewportPoint: (x, y) => [(y - y0) * scale, (x - x0) * scale],
        convertToPdfPoint: (px, py) => [py / scale + x0, px / scale + y0],
      };
}

const A4 = [0, 0, 595.276, 841.89];
const OFFSET_ORIGIN = [10, 20, 610, 820];

describe("page points", () => {
  it("measures from the top-left corner with y growing downwards", () => {
    expect(pagePointAt(2, viewport(A4, 1, 0), 0, 0)).toEqual({ page: 2, x: 0, y: 0 });
    const bottom = pagePointAt(1, viewport(A4, 2, 0), 200, 1683.78);
    expect(bottom.x).toBeCloseTo(100);
    expect(bottom.y).toBeCloseTo(841.89);
  });

  it("accounts for a view box that does not start at the origin", () => {
    // PDF point (110, 720) lies 100 points right of the left edge and 100 below the top edge (820).
    expect(pagePointAt(1, viewport(OFFSET_ORIGIN, 1, 0), 100, 100)).toEqual({ page: 1, x: 100, y: 100 });
    expect(pixelOffsetOf(viewport(OFFSET_ORIGIN, 2, 0), { page: 1, x: 100, y: 100 })).toEqual([200, 200]);
  });

  it.each([[0], [90]] as const)("returns the point a pixel position came from at rotation %i", (rotation) => {
    const view = viewport(OFFSET_ORIGIN, 1.5, rotation);
    const point = { page: 3, x: 123.4, y: 456.7 };
    const [px, py] = pixelOffsetOf(view, point);
    const back = pagePointAt(3, view, px, py);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("puts a point beyond the page on its edge", () => {
    const view = viewport(A4, 1, 0);
    expect(pixelOffsetOf(view, { page: 1, x: 9999, y: -50 })).toEqual([595.276, 0]);
    expect(pixelOffsetOf(view, { page: 1, x: -5, y: 9999 })).toEqual([0, 841.89]);
  });
});
