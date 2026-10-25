/**
 * @jest-environment jsdom
 */
// Tests the windowed paper list under a stubbed layout: rendered row count, re-slicing, spacers, sticky labels, the tray and aria rows.
import type { PaperFile } from "@labshelf/core";
import { mountForTest, paper } from "../../mountHarness";

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
