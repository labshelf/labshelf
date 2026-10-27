/**
 * @jest-environment jsdom
 */
// Tests the area mark: the percent geometry of a PDF area over its page, and the margin-bar variant.
import { renderAreaMark } from "../../../src/reader/dom/areaMark";
import type { PageViewportLike } from "../../../src/reader/dom/navigation";

const WIDTH = 600;
const HEIGHT = 800;

// Scale 1, no rotation: the viewport is the page in points.
const viewport: PageViewportLike & { width: number; height: number } = {
  width: WIDTH,
  height: HEIGHT,
  viewBox: [0, 0, WIDTH, HEIGHT],
  convertToPdfPoint: (x, y) => [x, HEIGHT - y],
  convertToViewportPoint: (x, y) => [x, HEIGHT - y],
};

describe("renderAreaMark", () => {
  it("positions the mark in percent of the page and sets its class", () => {
    const mark = renderAreaMark(viewport, { page: 1, left: 60, top: 80, right: 300, bottom: 160 }, { className: "rd-test-mark" });
    expect(mark.tagName).toBe("DIV");
    expect(mark.className).toBe("rd-test-mark");
    expect(mark.style.left).toBe("10%");
    expect(mark.style.top).toBe("10%");
    expect(mark.style.width).toBe("40%");
    expect(mark.style.height).toBe("10%");
  });

  it("puts a margin bar at the right edge of the area and leaves its width to CSS", () => {
    const mark = renderAreaMark(viewport, { page: 1, left: 60, top: 80, right: 300, bottom: 160 }, { className: "rd-test-mark", marginBar: true });
    expect(mark.style.left).toBe("50%");
    expect(mark.style.top).toBe("10%");
    expect(mark.style.width).toBe("");
    expect(mark.style.height).toBe("10%");
  });
});
