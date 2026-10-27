/**
 * @jest-environment jsdom
 */
// Checks that a highlight is drawn over its matched text lines, and over its stored box when the text is not found.
import type { Annotation } from "../../../src/model/index";
import { PageHighlights } from "../../../src/reader/dom/pageHighlights";

type Listener = (evt: { pageNumber: number }) => void;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function setup(): { page: HTMLElement; painter: PageHighlights; render: (page: number) => void } {
  document.body.innerHTML = `<div id="viewer"><div class="page" data-page-number="2"><div class="canvasWrapper"></div><div class="textLayer">
    <span id="l1">Chain-of-thought prompting</span><br><span id="l2">has several attractive</span><span id="far">elsewhere</span></div></div></div>`;
  const page = document.querySelector<HTMLElement>(".page")!;
  Object.defineProperty(page, "clientWidth", { value: 1000 });
  Object.defineProperty(page, "clientHeight", { value: 1000 });
  page.getBoundingClientRect = () => rect(0, 0, 1000, 1000);
  document.getElementById("l1")!.getBoundingClientRect = () => rect(100, 200, 400, 20);
  document.getElementById("l2")!.getBoundingClientRect = () => rect(100, 220, 400, 20);
  document.getElementById("far")!.getBoundingClientRect = () => rect(100, 800, 400, 20);
  let listener: Listener = () => undefined;
  const painter = new PageHighlights({ eventBus: { on: (_: string, fn: Listener) => { listener = fn; } } } as never);
  return { page, painter, render: (pageNumber) => listener({ pageNumber }) };
}

function highlight(content: string, extra: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1", paperId: "p", type: "highlight", pageNumber: 2, content, color: "green",
    position: { x: 0.1, y: 0.2, width: 0.4, height: 0.04 }, createdAt: "", updatedAt: "", ...extra,
  };
}

function marks(page: HTMLElement): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>(".rd-hl-layer .rd-hl")];
}

afterEach(() => { delete (Range.prototype as Partial<Range>).getClientRects; });

describe("PageHighlights", () => {
  it("draws one overlay per line of the matched text", () => {
    const { page, painter } = setup();
    let matched = "";
    Range.prototype.getClientRects = function (this: Range) {
      matched = this.toString();
      return [rect(150, 200, 350, 20), rect(100, 220, 120, 20)] as unknown as DOMRectList;
    };
    painter.show([highlight("prompting has several")]);
    expect(matched.replace(/\s+/g, "")).toBe("promptinghasseveral");
    const drawn = marks(page);
    expect(drawn.map((m) => [m.style.left, m.style.top])).toEqual([["15%", "20%"], ["10%", "22%"]]);
    expect(drawn[0]!.classList).toContain("rd-color-green");
    expect(page.querySelector(".rd-hl-layer")!.nextElementSibling!.classList).toContain("textLayer");
  });

  it("draws the stored box when the text is not inside it", () => {
    const { page, painter } = setup();
    painter.show([highlight("elsewhere")]);
    const drawn = marks(page);
    expect(drawn.map((m) => [m.style.left, m.style.top, m.style.width])).toEqual([["10%", "20%", "40%"]]);
  });

  it("leaves highlights without a position undrawn and clears removed ones", () => {
    const { page, painter } = setup();
    painter.show([highlight("elsewhere")]);
    const { position: _drop, ...listedOnly } = highlight("elsewhere");
    painter.show([listedOnly]);
    expect(page.querySelector(".rd-hl-layer")).toBeNull();
  });

  it("draws again when pdf.js rebuilds the page's text layer", () => {
    const { page, painter, render } = setup();
    painter.show([highlight("elsewhere")]);
    page.querySelector(".rd-hl-layer")!.remove();
    render(2);
    expect(marks(page)).toHaveLength(1);
  });
});
