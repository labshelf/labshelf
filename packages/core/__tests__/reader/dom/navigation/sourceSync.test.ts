/**
 * @jest-environment jsdom
 */
// Tests a preview's SyncTeX gestures: a double-click reports the page point, a revealed point scrolls into view and is marked briefly.
import { SourceSync } from "../../../../src/reader/dom/navigation/sourceSync";
import { DOCUMENT_REPLACED, type ReaderContext } from "../../../../src/reader/dom/session";
import type { PageViewportLike } from "../../../../src/reader/dom/navigation/pagePoints";

const PAGE_TOP = 300;
const PAGE_LEFT = 20;
const PAGE_HEIGHT = 842;

function setup(preview = true) {
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
    const { post, dblclick } = setup();
    dblclick("text", PAGE_LEFT + 100, PAGE_TOP + 50);
    expect(post).toHaveBeenCalledWith({ command: "showSource", point: { page: 2, x: 100, y: 50 } });
  });

  it("does nothing outside a preview, on a link or outside a page", () => {
    const off = setup(false);
    off.dblclick("text", 50, 350);
    expect(off.post).not.toHaveBeenCalled();
    const on = setup();
    on.dblclick("link", 50, 350);
    on.container.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(on.post).not.toHaveBeenCalled();
  });
});

describe("SourceSync reveal", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("scrolls the point to a third of the container height and marks it", () => {
    const { sync, container, marker } = setup();
    sync.reveal({ page: 2, x: 120, y: 500 });
    // Content y: page top 300 + 500 down the page; the container shows it 900 / 3 = 300 below its top.
    expect(container.scrollTop).toBe(300 + 500 - 300);
    expect(marker()?.style.top).toBe("800px");
    expect(marker()?.style.left).toBe(`${PAGE_LEFT + 120}px`);
  });

  it("clamps a page beyond the document to the last page", () => {
    const { sync, getPageView, marker } = setup();
    sync.reveal({ page: 99, x: 10, y: 10 });
    expect(getPageView).toHaveBeenCalledWith(2);
    expect(marker()).not.toBeNull();
  });

  it("scrolls sideways only when the point is out of sight", () => {
    const { sync, container } = setup();
    sync.reveal({ page: 2, x: 100, y: 10 });
    expect(container.scrollLeft).toBe(0);
    sync.reveal({ page: 2, x: 590, y: 10 });
    // Content x 610 is past the 400 px shown, so it is centred.
    expect(container.scrollLeft).toBe(610 - 200);
  });

  it("keeps one marker, removes it after a moment and when the document is replaced", () => {
    const { sync, handlers, container, marker } = setup();
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
