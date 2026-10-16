/**
 * @jest-environment jsdom
 */
// Tests the change marks drawn over each page: percent positions, redraw on page render, clearing.
import { ChangeMarks } from "../../../../src/reader/dom/navigation/changeMarks";
import { DOCUMENT_REPLACED, type ReaderContext } from "../../../../src/reader/dom/session";
import type { PageViewportLike } from "../../../../src/reader/dom/navigation/pagePoints";

const WIDTH = 600;
const HEIGHT = 800;

function setup() {
  document.body.innerHTML = `<div id="p1"></div><div id="p2"></div>`;
  const pages = [document.getElementById("p1")!, document.getElementById("p2")!];
  // Scale 1, no rotation: the viewport is the page in points.
  const viewport: PageViewportLike & { width: number; height: number } = {
    width: WIDTH,
    height: HEIGHT,
    viewBox: [0, 0, WIDTH, HEIGHT],
    convertToPdfPoint: (x, y) => [x, HEIGHT - y],
    convertToViewportPoint: (x, y) => [x, HEIGHT - y],
  };
  const handlers = new Map<string, (event?: unknown) => void>();
  const ctx = {
    pdfViewer: { getPageView: (index: number) => (pages[index] ? { div: pages[index], viewport } : undefined) },
    eventBus: { on: (name: string, fn: (event?: unknown) => void) => handlers.set(name, fn) },
  } as unknown as ReaderContext;
  const marks = new ChangeMarks(ctx);
  const marksOf = (index: number) => Array.from(pages[index]!.querySelectorAll<HTMLElement>(".rd-change-mark"));
  return { marks, handlers, pages, marksOf };
}

describe("ChangeMarks", () => {
  it("draws a mark positioned in percent of the page", () => {
    const { marks, marksOf } = setup();
    marks.show([{ page: 1, left: 60, top: 80, right: 300, bottom: 160 }]);
    const [mark] = marksOf(0);
    expect(marksOf(0)).toHaveLength(1);
    expect(mark!.style.left).toBe("10%");
    expect(mark!.style.top).toBe("10%");
    expect(mark!.style.width).toBe("40%");
    expect(mark!.style.height).toBe("10%");
    expect(marksOf(1)).toHaveLength(0);
  });

  it("replaces earlier marks, drawing several areas of one page", () => {
    const { marks, marksOf } = setup();
    marks.show([{ page: 1, left: 0, top: 0, right: 10, bottom: 10 }]);
    marks.show([{ page: 1, left: 0, top: 0, right: 10, bottom: 10 }, { page: 1, left: 20, top: 20, right: 30, bottom: 30 }, { page: 2, left: 0, top: 0, right: 5, bottom: 5 }]);
    expect(marksOf(0)).toHaveLength(2);
    expect(marksOf(1)).toHaveLength(1);
  });

  it("clears every page on an empty list", () => {
    const { marks, marksOf } = setup();
    marks.show([{ page: 1, left: 0, top: 0, right: 10, bottom: 10 }, { page: 2, left: 0, top: 0, right: 10, bottom: 10 }]);
    marks.show([]);
    expect(marksOf(0)).toHaveLength(0);
    expect(marksOf(1)).toHaveLength(0);
  });

  it("redraws a page that pdf.js emptied when it re-rendered", () => {
    const { marks, handlers, pages, marksOf } = setup();
    marks.show([{ page: 2, left: 0, top: 0, right: 10, bottom: 10 }]);
    pages[1]!.innerHTML = "";
    expect(marksOf(1)).toHaveLength(0);
    handlers.get("pagerendered")!({ pageNumber: 2 });
    expect(marksOf(1)).toHaveLength(1);
  });

  it("does not duplicate marks when a page renders without being emptied", () => {
    const { marks, handlers, marksOf } = setup();
    marks.show([{ page: 1, left: 0, top: 0, right: 10, bottom: 10 }]);
    handlers.get("pagerendered")!({ pageNumber: 1 });
    expect(marksOf(0)).toHaveLength(1);
  });

  it("ignores a page the viewer does not have", () => {
    const { marks, handlers } = setup();
    expect(() => {
      marks.show([{ page: 9, left: 0, top: 0, right: 10, bottom: 10 }]);
      handlers.get("pagerendered")!({ pageNumber: 9 });
    }).not.toThrow();
  });

  it("draws the marks it holds again on the replaced document", () => {
    const { marks, handlers, marksOf } = setup();
    marks.show([{ page: 1, left: 0, top: 0, right: 10, bottom: 10 }]);
    document.getElementById("p1")!.innerHTML = "";
    handlers.get(DOCUMENT_REPLACED)!();
    expect(marksOf(0)).toHaveLength(1);
  });
});
