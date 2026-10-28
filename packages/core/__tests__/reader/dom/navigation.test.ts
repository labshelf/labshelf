/** @jest-environment jsdom */
// Tests reader navigation: zoom, keyboard shortcuts, page points and source sync.
import { Keyboard, SourceSync, Zoom, derivePagePoint, derivePixelOffset, type PageViewportLike } from "../../../src/reader/dom/navigation";
import { DOCUMENT_REPLACED } from "../../../src/reader/dom/pdfLoader";
import type { ReaderContext } from "../../../src/reader/dom/readerSession";
import { CHORD_TIMEOUT_MS } from "../../../src/reader/keymap";

function setupZoom() {
  const container = document.createElement("div");
  let width = 800;
  let height = 600;
  Object.defineProperties(container, { clientWidth: { get: () => width }, clientHeight: { get: () => height } });
  let resize = () => undefined as void;
  global.ResizeObserver = class {
    constructor(callback: () => void) { resize = callback; }
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  let value = "page-fit";
  const fit = jest.fn((next: string) => { value = next; });
  const pdfViewer = { get currentScaleValue() { return value; }, set currentScaleValue(next: string) { fit(next); }, update: jest.fn() };
  new Zoom({ container, pdfViewer } as unknown as ReaderContext);
  return { pdfViewer, fit, size(w: number, h: number) { width = w; height = h; resize(); } };
}

describe("viewport fitting", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fits once at the final size after dragging the divider", () => {
    const t = setupZoom();
    for (const width of [700, 500, 350, 600]) { t.size(width, 600); jest.advanceTimersByTime(20); }
    expect(t.fit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120);
    expect(t.fit.mock.calls).toEqual([["page-fit"]]);
  });

  it("ignores hidden viewports and refits when shown", () => {
    const t = setupZoom();
    t.size(500, 600);
    t.size(0, 0);
    jest.advanceTimersByTime(120);
    expect(t.fit).not.toHaveBeenCalled();
    expect(t.pdfViewer.update).not.toHaveBeenCalled();
    t.size(500, 600);
    jest.advanceTimersByTime(120);
    expect(t.fit).toHaveBeenCalledTimes(1);
  });

  it("refits page-fit when only the height changes", () => {
    const t = setupZoom();
    t.size(800, 400);
    jest.advanceTimersByTime(120);
    expect(t.fit).toHaveBeenCalledWith("page-fit");
  });

  it("preserves numeric zoom after a resize", () => {
    const t = setupZoom();
    t.pdfViewer.currentScaleValue = "1.5";
    t.fit.mockClear();
    t.size(600, 500);
    jest.advanceTimersByTime(120);
    expect(t.fit).not.toHaveBeenCalled();
    expect(t.pdfViewer.update).toHaveBeenCalledTimes(1);
  });
});

const press = (key: string): void => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); };

function setupKeyboard() {
  const run = jest.fn();
  const ctx = { prefs: { vimKeys: true }, boot: { isMac: false, preview: false } };
  new Keyboard(ctx as never, run);
  return run;
}

describe("keyboard chord prefix", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("completes gg inside the timeout", () => {
    const run = setupKeyboard();
    press("g");
    jest.advanceTimersByTime(CHORD_TIMEOUT_MS - 1);
    press("g");
    expect(run).toHaveBeenCalledWith("firstPage");
  });

  it("forgets the first g once the timeout has passed", () => {
    const run = setupKeyboard();
    press("g");
    jest.advanceTimersByTime(CHORD_TIMEOUT_MS);
    press("g");
    expect(run).not.toHaveBeenCalled();
  });
});

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
    expect(derivePagePoint(2, viewport(A4, 1, 0), 0, 0)).toEqual({ page: 2, x: 0, y: 0 });
    const bottom = derivePagePoint(1, viewport(A4, 2, 0), 200, 1683.78);
    expect(bottom.x).toBeCloseTo(100);
    expect(bottom.y).toBeCloseTo(841.89);
  });

  it("accounts for a view box that does not start at the origin", () => {
    // PDF point (110, 720) lies 100 points right of the left edge and 100 below the top edge (820).
    expect(derivePagePoint(1, viewport(OFFSET_ORIGIN, 1, 0), 100, 100)).toEqual({ page: 1, x: 100, y: 100 });
    expect(derivePixelOffset(viewport(OFFSET_ORIGIN, 2, 0), { page: 1, x: 100, y: 100 })).toEqual([200, 200]);
  });

  it.each([[0], [90]] as const)("returns the point a pixel position came from at rotation %i", (rotation) => {
    const view = viewport(OFFSET_ORIGIN, 1.5, rotation);
    const point = { page: 3, x: 123.4, y: 456.7 };
    const [px, py] = derivePixelOffset(view, point);
    const back = derivePagePoint(3, view, px, py);
    expect(back.x).toBeCloseTo(point.x);
    expect(back.y).toBeCloseTo(point.y);
  });

  it("puts a point beyond the page on its edge", () => {
    const view = viewport(A4, 1, 0);
    expect(derivePixelOffset(view, { page: 1, x: 9999, y: -50 })).toEqual([595.276, 0]);
    expect(derivePixelOffset(view, { page: 1, x: -5, y: 9999 })).toEqual([0, 841.89]);
  });
});

const PAGE_TOP = 300;
const PAGE_LEFT = 20;
const PAGE_HEIGHT = 842;

function setupSourceSync(preview = true) {
  document.body.innerHTML = `<div id="c"><div id="viewer"><div class="page" data-page-number="2"><a href="#x" id="link">l</a><span id="text">t</span></div></div></div>`;
  const container = document.getElementById("c") as HTMLDivElement;
  const pageEl = container.querySelector(".page") as HTMLElement;
  Object.defineProperty(container, "clientHeight", { value: 900 });
  Object.defineProperty(container, "clientWidth", { value: 400 });
  container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
  pageEl.getBoundingClientRect = () => ({ left: PAGE_LEFT, top: PAGE_TOP - container.scrollTop }) as DOMRect;
  // Scale 1, no rotation, A4: the viewport is the page in points.
  const viewport: PageViewportLike = {
    viewBox: [0, 0, 595, PAGE_HEIGHT],
    convertToPdfPoint: (x, y) => [x, PAGE_HEIGHT - y],
    convertToViewportPoint: (x, y) => [x, PAGE_HEIGHT - y],
  };
  const getPageView = jest.fn((index: number) => (index === 1 || index === 2 ? { div: pageEl, viewport } : undefined));
  const handlers = new Map<string, () => void>();
  const post = jest.fn();
  const ctx = {
    boot: { preview },
    host: { post },
    container,
    pdfDocument: { numPages: 3 },
    pdfViewer: { getPageView, currentPageNumber: 2 },
    eventBus: { on: (name: string, fn: () => void) => handlers.set(name, fn) },
  } as unknown as ReaderContext;
  const sync = new SourceSync(ctx);
  const dblclick = (id: string, clientX: number, clientY: number) =>
    document.getElementById(id)!.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX, clientY }));
  return { sync, ctx, container, post, getPageView, handlers, dblclick, marker: () => container.querySelector<HTMLElement>(".rd-sync-marker") };
}

describe("SourceSync double-click", () => {
  it("posts the page point behind the click in a preview", () => {
    const { post, dblclick } = setupSourceSync();
    dblclick("text", PAGE_LEFT + 100, PAGE_TOP + 50);
    expect(post).toHaveBeenCalledWith({ command: "showSource", point: { page: 2, x: 100, y: 50 } });
  });

  it("does nothing outside a preview, on a link or outside a page", () => {
    const off = setupSourceSync(false);
    off.dblclick("text", 50, 350);
    expect(off.post).not.toHaveBeenCalled();
    const on = setupSourceSync();
    on.dblclick("link", 50, 350);
    on.container.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(on.post).not.toHaveBeenCalled();
  });
});

describe("SourceSync reveal", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("scrolls the point to a third of the container height and marks it", () => {
    const { sync, container, marker } = setupSourceSync();
    sync.reveal({ page: 2, x: 120, y: 500 });
    // Content y: page top 300 + 500 down the page; the container shows it 900 / 3 = 300 below its top.
    expect(container.scrollTop).toBe(300 + 500 - 300);
    expect(marker()?.style.top).toBe("800px");
    expect(marker()?.style.left).toBe(`${PAGE_LEFT + 120}px`);
  });

  it("clamps a page beyond the document to the last page", () => {
    const { sync, getPageView, marker } = setupSourceSync();
    sync.reveal({ page: 99, x: 10, y: 10 });
    expect(getPageView).toHaveBeenCalledWith(2);
    expect(marker()).not.toBeNull();
  });

  it("scrolls sideways only when the point is out of sight", () => {
    const { sync, container } = setupSourceSync();
    sync.reveal({ page: 2, x: 100, y: 10 });
    expect(container.scrollLeft).toBe(0);
    sync.reveal({ page: 2, x: 590, y: 10 });
    // Content x 610 is past the 400 px shown, so it is centred.
    expect(container.scrollLeft).toBe(610 - 200);
  });

  it("keeps one marker, removes it after a moment and when the document is replaced", () => {
    const { sync, handlers, container, marker } = setupSourceSync();
    sync.reveal({ page: 2, x: 1, y: 1 });
    sync.reveal({ page: 2, x: 2, y: 2 });
    expect(container.querySelectorAll(".rd-sync-marker")).toHaveLength(1);
    jest.advanceTimersByTime(2000);
    expect(marker()).toBeNull();
    sync.reveal({ page: 2, x: 3, y: 3 });
    handlers.get(DOCUMENT_REPLACED)?.();
    expect(marker()).toBeNull();
  });
});
