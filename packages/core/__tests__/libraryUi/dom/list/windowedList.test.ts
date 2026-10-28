/**
 * @jest-environment jsdom
 */
// Tests the windowed paper list: the row window and row height, and the rendered rows, keyboard and focus under a stubbed layout.
import type { PaperFile } from "@labshelf/core";
import { mountForTest, paper } from "../mountHarness";
import { createRowWindow, readRowHeight } from "../../../../src/libraryUi/dom/list/windowedList";

const ROW = 34;
const VIEW = 340;
let scrollTop = 0;
const restores: Array<() => void> = [];

function stub(name: "clientHeight" | "offsetHeight", get: (el: HTMLElement) => number): void {
  const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, name);
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, get() { return get(this as HTMLElement); } });
  restores.push(() => { if (before) Object.defineProperty(HTMLElement.prototype, name, before); });
}

beforeEach(() => {
  scrollTop = 0;
  stub("clientHeight", (el) => (el.classList.contains("paper-list") ? VIEW : 0));
  stub("offsetHeight", (el) => {
    // The row height probe: jsdom drops its var() height, so it is told apart by where it sits.
    if (el.parentElement?.classList.contains("paper-list") && !el.className) return ROW;
    return el.classList.contains("paper-children") ? el.childElementCount * ROW : 0;
  });
});
afterEach(() => { while (restores.length) restores.pop()!(); });

const id = (i: number): string => `p${String(i).padStart(4, "0")}`;
const many = (n: number, dir = "papers") => Array.from({ length: n }, (_, i) => paper(id(i), dir, { title: id(i) }));
const file = (name: string): PaperFile => ({ name, kind: "file", size: 1, modified: "2026-10-03T12:00:00Z" });

function mounted(papers = many(2000), folder?: string) {
  const t = mountForTest({ sortKey: "title", sortDir: 1 });
  const list = t.container.querySelector<HTMLElement>(".paper-list")!;
  Object.defineProperty(list, "scrollTop", { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
  t.snapshot(papers, papers.map((p) => p.path));
  if (folder) t.lib.store.set({ folder });
  const body = list.querySelector<HTMLElement>(".paper-rows")!;
  const scrollTo = async (top: number): Promise<void> => {
    scrollTop = top;
    list.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
  };
  const pad = (side: "Top" | "Bottom"): number => Number.parseFloat(body.style[`padding${side}`] || "0");
  return { ...t, list, body, scrollTo, pad };
}

describe("windowed paper list", () => {
  it("renders the viewport plus overscan of 2,000 papers, and spacers make up the rest", () => {
    const t = mounted();
    expect(t.rows()).toHaveLength(VIEW / ROW + 10);
    expect(t.pad("Top") + t.rows().length * ROW + t.pad("Bottom")).toBe(2000 * ROW);
  });

  it("re-slices on scroll", async () => {
    const t = mounted();
    await t.scrollTo(1000 * ROW);
    expect(t.rows()).toHaveLength(VIEW / ROW + 20);
    expect(t.rowIds()[0]).toBe(id(990));
    expect(t.pad("Top")).toBe(990 * ROW);
    expect(t.pad("Top") + t.rows().length * ROW + t.pad("Bottom")).toBe(2000 * ROW);
  });

  it("keeps the group label of a slice that starts inside the group, and its full count", async () => {
    const t = mounted([...many(50, "papers/ml"), ...many(100, "papers/ml/deep").map((p) => ({ ...p, id: `d${p.id}`, title: `z${p.title}` }))], "papers/ml");
    // Flat rows: own papers 0-49, the deep label 50, deep papers 51-150; the slice starts at row 70.
    await t.scrollTo(80 * ROW);
    expect(t.container.querySelectorAll(".group-label")).toHaveLength(1);
    expect(t.rowIds()[0]).toBe(`d${id(19)}`);
    expect(t.pad("Top")).toBe(70 * ROW - ROW);
    expect(t.container.querySelector('[role="rowgroup"][aria-label]')!.getAttribute("aria-label")).toBe("deep, 100 papers");
  });

  it("shifts the top spacer by the open tray's height once the open paper is above the window", async () => {
    const t = mounted();
    t.lib.store.openPaper(id(5));
    t.files(id(5), { status: "ready", files: [file("paper.pdf"), file("a.txt"), file("b.txt")] });
    const trayRows = t.container.querySelectorAll('.paper-children [role="row"]').length;
    expect(trayRows).toBeGreaterThan(0);
    await t.scrollTo(1000 * ROW + trayRows * ROW);
    expect(t.rowIds()[0]).toBe(id(990));
    expect(t.pad("Top")).toBe(990 * ROW + trayRows * ROW);
    expect(t.pad("Top") + t.rows().length * ROW + t.pad("Bottom")).toBe(2000 * ROW + trayRows * ROW);
  });

  it("numbers the heads, papers and tray rows for the full list", () => {
    const t = mounted();
    t.lib.store.openPaper(id(5));
    t.files(id(5), { status: "ready", files: [file("paper.pdf"), file("a.txt")] });
    const tray = [...t.container.querySelectorAll('.paper-children [role="row"]')];
    const main = (i: number): string | null => t.rows().find((r) => r.dataset["id"] === id(i))!.querySelector(".paper-row-main")!.getAttribute("aria-rowindex");
    expect(t.list.getAttribute("aria-rowcount")).toBe(String(1 + 2000 + tray.length));
    expect(t.container.querySelector(".col-heads")!.getAttribute("aria-rowindex")).toBe("1");
    expect(main(3)).toBe("5");
    expect(main(5)).toBe("7");
    expect(tray.map((r) => r.getAttribute("aria-rowindex"))).toEqual(tray.map((_, j) => String(8 + j)));
    expect(main(6)).toBe(String(8 + tray.length));
  });
});

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
    expect(readRowHeight(el)).toBe(22);
  });

  it("takes the probe's resolved height when layout exists, so a calc() token works", () => {
    const el = document.createElement("div");
    el.style.setProperty("--ls-row-h", "calc(22px + 12px)");
    document.body.append(el);
    const spy = jest.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(34);
    expect(readRowHeight(el)).toBe(34);
    spy.mockRestore();
    expect(el.childElementCount).toBe(0);
  });

  it("throws with context when the token is missing", () => {
    const el = document.createElement("div");
    document.body.append(el);
    expect(() => readRowHeight(el)).toThrow(/--ls-row-h/);
  });
});

const N = 2000;


function mountedWindowedKeys() {
  const t = mountForTest({ sortKey: "title", sortDir: 1 });
  const list = t.container.querySelector<HTMLElement>(".paper-list")!;
  Object.defineProperty(list, "scrollTop", { configurable: true, get: () => scrollTop, set: (v: number) => { scrollTop = v; } });
  const papers = Array.from({ length: N }, (_, i) => paper(id(i), "papers", { title: id(i) }));
  t.snapshot(papers, papers.map((p) => p.path));
  const scrollTo = async (top: number): Promise<void> => {
    scrollTop = top;
    list.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
  };
  const focusedId = (): string => (document.activeElement as HTMLElement).closest<HTMLElement>(".paper-row")?.dataset["id"] ?? "";
  const cursor = (): string | null => t.lib.store.get().cursor;
  return { ...t, list, scrollTo, focusedId, cursor };
}

describe("windowed paper list keyboard", () => {
  it("End focuses and renders the last paper, Home goes back to the first", () => {
    const t = mountedWindowedKeys();
    t.key("End");
    expect(t.cursor()).toBe(id(N - 1));
    expect(t.rowIds()).toContain(id(N - 1));
    expect(t.focusedId()).toBe(id(N - 1));
    t.key("Home");
    expect(t.cursor()).toBe(id(0));
    expect(t.focusedId()).toBe(id(0));
    expect(t.rowIds()).toContain(id(0));
  });

  it("PageDown moves by a viewport minus one row, across the window edge", () => {
    const t = mountedWindowedKeys();
    t.key("Home");
    t.key("PageDown");
    expect(t.cursor()).toBe(id(9));
    for (let i = 0; i < 5; i++) t.key("PageDown");
    expect(t.cursor()).toBe(id(54));
    expect(t.focusedId()).toBe(id(54));
    expect(t.rowIds()).toContain(id(54));
    t.key("PageUp");
    expect(t.cursor()).toBe(id(45));
  });

  it("Shift+PageDown extends the selection beyond the rendered window", () => {
    const t = mountedWindowedKeys();
    t.key("Home");
    for (let i = 0; i < 10; i++) t.key("PageDown", { shiftKey: true });
    expect(t.cursor()).toBe(id(90));
    expect(t.lib.store.get().selected.size).toBe(91);
    expect(t.rowIds()).not.toContain(id(0));
  });

  it("ArrowDown continues from a cursor that scrolled out of the window", async () => {
    const t = mountedWindowedKeys();
    t.key("Home");
    await t.scrollTo(1000 * ROW);
    t.key("ArrowDown");
    expect(t.cursor()).toBe(id(1));
    expect(t.focusedId()).toBe(id(1));
  });
});

describe("windowed paper list focus", () => {
  it("moves focus to the grid when the focused row scrolls out and back when it returns", async () => {
    const t = mountedWindowedKeys();
    t.key("Home");
    expect(t.focusedId()).toBe(id(0));
    await t.scrollTo(1000 * ROW);
    expect(document.activeElement).toBe(t.list);
    expect(t.list.tabIndex).toBe(-1);
    await t.scrollTo(0);
    expect(t.focusedId()).toBe(id(0));
    expect(t.list.querySelectorAll('[role="row"][tabindex="0"]')).toHaveLength(1);
  });

  it("leaves focus alone when it was not in a row", async () => {
    const t = mountedWindowedKeys();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await t.scrollTo(1000 * ROW);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
