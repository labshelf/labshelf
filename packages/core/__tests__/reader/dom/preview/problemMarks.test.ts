/**
 * @jest-environment jsdom
 */
// Tests the problem marks drawn over each placed problem's area: placement, redraw on page render and zoom, flash.
import { mountProblemMarks } from "../../../../src/reader/dom/preview/problemMarks";
import type { PdfProblem } from "../../../../src/reader/index";

const WIDTH = 600;
const HEIGHT = 800;

function setup() {
  document.body.innerHTML = `<div id="viewer"><div id="p1"></div><div id="p2"></div></div>`;
  const container = document.getElementById("viewer")!;
  const pages = [document.getElementById("p1")!, document.getElementById("p2")!];
  // Scale 1, no rotation: the viewport is the page in points.
  const viewport = {
    width: WIDTH,
    height: HEIGHT,
    viewBox: [0, 0, WIDTH, HEIGHT],
    convertToPdfPoint: (x: number, y: number) => [x, HEIGHT - y],
    convertToViewportPoint: (x: number, y: number) => [x, HEIGHT - y],
  };
  const handlers = new Map<string, (event?: unknown) => void>();
  const pdfViewer = {
    pagesCount: pages.length,
    getPageView: (index: number) => (pages[index] ? { div: pages[index], viewport } : undefined),
    eventBus: { on: (name: string, fn: (event?: unknown) => void) => handlers.set(name, fn) },
  };
  const marks = mountProblemMarks({ container, pdfViewer: pdfViewer as never });
  const marksOf = (index: number) => Array.from(pages[index]!.querySelectorAll<HTMLElement>(".rd-problem-marks > *"));
  return { marks, handlers, pages, marksOf };
}

const area = { page: 1, left: 60, top: 80, right: 300, bottom: 160 };
const problems: PdfProblem[] = [
  { kind: "undefinedCitation", message: "a", area },
  { kind: "preprint", message: "b", area: { ...area, page: 2 } },
  { kind: "overfull", message: "c" },
  { kind: "overfull", message: "d", area },
];

describe("mountProblemMarks", () => {
  it("draws one hidden mark per placed problem on its page and none for unplaced ones", () => {
    const { marks, marksOf, pages } = setup();
    marks.setProblems(problems);
    expect(marksOf(0)).toHaveLength(2);
    expect(marksOf(1)).toHaveLength(1);
    expect(pages[0]!.querySelectorAll(".rd-problem-marks")).toHaveLength(1);
    expect(pages[0]!.querySelector(".rd-problem-marks")!.getAttribute("aria-hidden")).toBe("true");
    const [mark] = marksOf(0);
    expect(mark!.className).toContain("rd-problem-mark--undefinedCitation");
    expect(mark!.getAttribute("aria-hidden")).toBe("true");
    expect(mark!.style.left).toBe("10%");
    expect(mark!.style.top).toBe("10%");
    expect(mark!.style.width).toBe("40%");
    expect(mark!.style.height).toBe("10%");
    const bar = marksOf(0)[1]!;
    expect(bar.className).toContain("rd-problem-mark--overfull");
    expect(bar.style.left).toBe("50%");
    expect(bar.style.width).toBe("");
  });

  it("keeps one set of marks when a page re-renders or the zoom changes", () => {
    const { marks, handlers, marksOf, pages } = setup();
    marks.setProblems(problems);
    handlers.get("pagerendered")!({ pageNumber: 1 });
    handlers.get("scalechanging")!();
    expect(marksOf(0)).toHaveLength(2);
    expect(marksOf(1)).toHaveLength(1);
    expect(pages[0]!.querySelectorAll(".rd-problem-marks")).toHaveLength(1);
  });

  it("redraws marks that pdf.js removed with the page contents", () => {
    const { marks, handlers, marksOf, pages } = setup();
    marks.setProblems(problems);
    pages[0]!.replaceChildren();
    handlers.get("pagerendered")!({ pageNumber: 1 });
    expect(marksOf(0)).toHaveLength(2);
  });

  it("clears the marks when the problems are replaced by an empty list", () => {
    const { marks, marksOf } = setup();
    marks.setProblems(problems);
    marks.setProblems([]);
    expect(marksOf(0)).toHaveLength(0);
    expect(marksOf(1)).toHaveLength(0);
  });

  it("flashes the mark of a problem index for a short time, and ignores unplaced or unknown indexes", () => {
    jest.useFakeTimers();
    const { marks, marksOf } = setup();
    marks.setProblems(problems);
    marks.flash(2);
    marks.flash(9);
    expect(document.querySelectorAll(".rd-problem-mark--flash")).toHaveLength(0);
    marks.flash(3);
    expect(marksOf(0)[1]!.classList.contains("rd-problem-mark--flash")).toBe(true);
    jest.runAllTimers();
    expect(document.querySelectorAll(".rd-problem-mark--flash")).toHaveLength(0);
    jest.useRealTimers();
  });
});
