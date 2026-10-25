/**
 * @jest-environment jsdom
 */
import { createRowWindow, measureRowHeight } from "../../../../../src/libraryUi/dom/list/window";

const win = createRowWindow({ rowHeight: 20 });
const view = (scrollTop: number, height = 200) => ({ scrollTop, height });

describe("row window slice", () => {
  it("at the top renders the viewport plus overscan below", () => {
    expect(win.slice(1000, view(0))).toEqual({ start: 0, end: 20, padTop: 0, padBottom: 980 * 20 });
  });

  it("in the middle renders overscan on both sides", () => {
    expect(win.slice(1000, view(5000))).toEqual({ start: 240, end: 270, padTop: 240 * 20, padBottom: 730 * 20 });
  });

  it("starts the slice at a partly visible row", () => {
    expect(win.slice(1000, view(5010)).start).toBe(240);
    expect(win.slice(1000, view(5010)).end).toBe(271);
  });

  it("at the end stops at the last row with no bottom spacer", () => {
    expect(win.slice(1000, view(1000 * 20 - 200))).toEqual({ start: 980, end: 1000, padTop: 980 * 20, padBottom: 0 });
  });

  it("after a collapse leaves fewer rows, clamps a stale scrollTop to the new end", () => {
    expect(win.slice(100, view(5000))).toEqual({ start: 80, end: 100, padTop: 80 * 20, padBottom: 0 });
  });

  it("renders every row when the model fits the viewport", () => {
    expect(win.slice(5, view(0))).toEqual({ start: 0, end: 5, padTop: 0, padBottom: 0 });
    expect(win.slice(0, view(300))).toEqual({ start: 0, end: 0, padTop: 0, padBottom: 0 });
  });

  it("after a resize to a taller viewport renders more rows", () => {
    expect(win.slice(1000, view(0, 600)).end).toBe(40);
  });

  it("keeps the total height constant across slices", () => {
    for (const top of [0, 3333, 19800]) {
      const s = win.slice(1000, view(top));
      expect(s.padTop + (s.end - s.start) * 20 + s.padBottom).toBe(1000 * 20);
    }
  });

  it("honours a custom overscan", () => {
    expect(createRowWindow({ rowHeight: 20, overscan: 0 }).slice(1000, view(5000))).toEqual({ start: 250, end: 260, padTop: 5000, padBottom: 740 * 20 });
  });

  it("rejects a non-positive row height", () => {
    expect(() => createRowWindow({ rowHeight: 0 })).toThrow(/row height/);
  });
});

describe("row window positions", () => {
  it("maps a scrollTop to the row under it", () => {
    expect(win.indexAt(0)).toBe(0);
    expect(win.indexAt(59)).toBe(2);
    expect(win.indexAt(60)).toBe(3);
  });

  it("keeps scrollTop when the row is already in view", () => {
    expect(win.scrollTopFor(12, view(100))).toBe(100);
  });

  it("scrolls up so a row above the view sits at the top", () => {
    expect(win.scrollTopFor(2, view(100))).toBe(40);
  });

  it("scrolls down so a row below the view sits at the bottom", () => {
    expect(win.scrollTopFor(30, view(100))).toBe(31 * 20 - 200);
  });
});

describe("measureRowHeight", () => {
  it("reads the row height token in pixels", () => {
    const el = document.createElement("div");
    el.style.setProperty("--ls-row-h", "22px");
    document.body.append(el);
    expect(measureRowHeight(el)).toBe(22);
  });

  it("takes the probe's resolved height when layout exists, so a calc() token works", () => {
    const el = document.createElement("div");
    el.style.setProperty("--ls-row-h", "calc(22px + 12px)");
    document.body.append(el);
    const spy = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(34);
    expect(measureRowHeight(el)).toBe(34);
    spy.mockRestore();
    expect(el.childElementCount).toBe(0);
  });

  it("throws with context when the token is missing", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(() => measureRowHeight(el)).toThrow(/--ls-row-h/);
  });
});
