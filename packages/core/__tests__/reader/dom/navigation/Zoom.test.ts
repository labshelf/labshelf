/** @jest-environment jsdom */
// Tests fitting the PDF after the reader viewport settles.
import { Zoom } from "../../../../src/reader/dom/navigation/index";
import type { ReaderContext } from "../../../../src/reader/dom/session/index";

function setup() {
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
    const t = setup();
    for (const width of [700, 500, 350, 600]) { t.size(width, 600); jest.advanceTimersByTime(20); }
    expect(t.fit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(120);
    expect(t.fit.mock.calls).toEqual([["page-fit"]]);
  });

  it("ignores hidden viewports and refits when shown", () => {
    const t = setup();
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
    const t = setup();
    t.size(800, 400);
    jest.advanceTimersByTime(120);
    expect(t.fit).toHaveBeenCalledWith("page-fit");
  });

  it("preserves numeric zoom after a resize", () => {
    const t = setup();
    t.pdfViewer.currentScaleValue = "1.5";
    t.fit.mockClear();
    t.size(600, 500);
    jest.advanceTimersByTime(120);
    expect(t.fit).not.toHaveBeenCalled();
    expect(t.pdfViewer.update).toHaveBeenCalledTimes(1);
  });
});
