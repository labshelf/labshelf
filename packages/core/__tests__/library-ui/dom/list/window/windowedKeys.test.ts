/**
 * @jest-environment jsdom
 */
// Tests keyboard and focus over the windowed paper list under a stubbed layout: Home/End, paging and focus parking.
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
  stub("offsetHeight", (el) => (el.parentElement?.classList.contains("paper-list") && !el.className ? ROW : 0));
});
afterEach(() => { while (restores.length) restores.pop()!(); });

const N = 2000;
const id = (i: number): string => `p${String(i).padStart(4, "0")}`;

function mounted() {
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
    const t = mounted();
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
    const t = mounted();
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
    const t = mounted();
    t.key("Home");
    for (let i = 0; i < 10; i++) t.key("PageDown", { shiftKey: true });
    expect(t.cursor()).toBe(id(90));
    expect(t.lib.store.get().selected.size).toBe(91);
    expect(t.rowIds()).not.toContain(id(0));
  });

  it("ArrowDown continues from a cursor that scrolled out of the window", async () => {
    const t = mounted();
    t.key("Home");
    await t.scrollTo(1000 * ROW);
    t.key("ArrowDown");
    expect(t.cursor()).toBe(id(1));
    expect(t.focusedId()).toBe(id(1));
  });
});

describe("windowed paper list focus", () => {
  it("moves focus to the grid when the focused row scrolls out and back when it returns", async () => {
    const t = mounted();
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
    const t = mounted();
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await t.scrollTo(1000 * ROW);
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
