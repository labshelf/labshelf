/**
 * @jest-environment jsdom
 */
// Tests the virtualized project treegrid: the rendered window, re-slicing on scroll, collapsing a group, aria and focus keeping.
import { DEFAULT_PROJECT_VIEW, type ProjectGroup } from "../../../../../src/writing/allProjects/viewModel/index";
import { mountProjectList, type ProjectList, type ProjectListHandlers } from "../../../../../src/writing/allProjects/dom/list/index";
import type { ProjectRow } from "../../../../../src/writing/allProjects/projectRow";

const ROW_H = 34;
const project = (i: number, folder?: string): ProjectRow =>
  ({ id: `/p/${i}`, title: `Project ${i}`, format: "latex", main: "main.tex", place: "projects", modified: i, ...(folder ? { folder } : {}) });
const range = (from: number, n: number, folder?: string): ProjectRow[] => Array.from({ length: n }, (_, k) => project(from + k, folder));

// 40 top-level projects, then folders A and B with 30 each: 102 model rows.
const GROUPS: ProjectGroup[] = [
  { key: "", segments: [], rows: range(0, 40) },
  { key: "A", segments: ["A"], rows: range(40, 30, "A") },
  { key: "B", segments: ["B"], rows: range(70, 30, "B") },
];

const handlers = (): ProjectListHandlers => ({
  onToggle: jest.fn(), onSelect: jest.fn(), onOpen: jest.fn(), onMenu: jest.fn(), onSort: jest.fn(),
  onOpenFile: jest.fn(), onToggleFolder: jest.fn(), onOpenLog: jest.fn(), onAddFile: jest.fn(),
});

function frameOf(groups: ProjectGroup[], extra: { expanded?: string; files?: string[]; selected?: string } = {}) {
  const files = extra.expanded && extra.files ? { [extra.expanded]: { status: "ready" as const, files: extra.files } } : {};
  return { view: DEFAULT_PROJECT_VIEW, groups, selected: extra.selected ?? null, empty: null,
    tray: { expanded: extra.expanded ?? null, files, detail: undefined, openFolders: new Set<string>() } };
}

function mount(groups = GROUPS) {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.append(container);
  const h = handlers();
  const list = mountProjectList(container, h);
  const el = container.querySelector<HTMLElement>(".paper-list")!;
  // jsdom has no layout: give the list a 5-row viewport and a scroll position the test drives.
  el.style.setProperty("--ls-row-h", `${ROW_H}px`);
  let top = 0;
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 5 * ROW_H });
  Object.defineProperty(el, "scrollTop", { configurable: true, get: () => top, set: (v: number) => { top = v; } });
  list.render(frameOf(groups));
  const rendered = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>(".paper-rows > [data-key]")];
  const rowOf = (node: HTMLElement): HTMLElement => (node.matches("[role=row]") ? node : node.querySelector<HTMLElement>("[role=row]")!);
  const scrollTo = async (px: number): Promise<void> => {
    top = px;
    el.dispatchEvent(new Event("scroll"));
    await new Promise((r) => requestAnimationFrame(r));
  };
  return { list, el, h, rendered, rowOf, scrollTo };
}

const keyOf = (list: ProjectList, i: number): string => list.rows()[i]!.key;

it("renders only the rows of the window and its overscan, with padding for the rest", () => {
  const { el, rendered } = mount();
  // 5 visible rows plus 10 of overscan below; nothing above the top.
  expect(rendered()).toHaveLength(15);
  const body = el.querySelector<HTMLElement>(".paper-rows")!;
  expect(body.style.paddingTop).toBe("0px");
  expect(body.style.paddingBottom).toBe(`${(102 - 15) * ROW_H}px`);
  expect(el.getAttribute("aria-rowcount")).toBe("103");
});

it("re-slices the rows when the list scrolls", async () => {
  const { el, rendered, rowOf, scrollTo } = mount();
  await scrollTo(50 * ROW_H);
  const rows = rendered();
  expect(rows).toHaveLength(25);
  expect(rowOf(rows[0]!).getAttribute("aria-rowindex")).toBe("42");
  expect(el.querySelector<HTMLElement>(".paper-rows")!.style.paddingTop).toBe(`${40 * ROW_H}px`);
});

it("collapses a group through the list, which removes its rows and lowers the row count", () => {
  const { list, el, rowOf } = mount();
  list.toggleGroup("A");
  expect(list.rows()).toHaveLength(72);
  expect(el.getAttribute("aria-rowcount")).toBe("73");
  expect(rowOf(list.reveal(40)!).getAttribute("aria-expanded")).toBe("false");
  expect(list.rows()[41]).toMatchObject({ kind: "group", key: "g:B" });
  expect(rowOf(list.reveal(42)!).closest<HTMLElement>("[data-id]")?.dataset["id"]).toBe("/p/70");
  list.toggleGroup("A");
  expect(el.getAttribute("aria-rowcount")).toBe("103");
});

it("marks rendered rows with their index, level and expansion", () => {
  const { list, rendered, rowOf } = mount();
  list.render(frameOf(GROUPS, { expanded: "/p/0", files: ["main.tex", "sec/intro.tex"] }));
  const rows = rendered().map(rowOf);
  expect(rows.map((r) => r.getAttribute("aria-rowindex")).slice(0, 3)).toEqual(["2", "3", "4"]);
  expect(rows[0]!.getAttribute("aria-level")).toBe("1");
  expect(rows[0]!.getAttribute("aria-expanded")).toBe("true");
  // The files tray lists the sec folder, main.tex and the Add file row, one level below the project.
  expect(rows.slice(1, 4).map((r) => r.getAttribute("aria-level"))).toEqual(["2", "2", "2"]);
  expect(rows[4]!.getAttribute("aria-expanded")).toBe("false");
  const header = rowOf(list.reveal(list.rows().findIndex((r) => r.kind === "group"))!);
  expect(header.getAttribute("aria-level")).toBe("1");
  expect(header.getAttribute("aria-expanded")).toBe("true");
  expect(rowOf(list.reveal(list.rows().findIndex((r) => r.kind === "group") + 1)!).getAttribute("aria-level")).toBe("2");
});

it("keeps focus on the same row across a rebuild and a re-slice", async () => {
  const { list, el, rendered, rowOf, scrollTo } = mount();
  const key = keyOf(list, 3);
  rowOf(rendered()[3]!).focus();
  const rows = GROUPS.map((g, i) => (i === 0 ? { ...g, rows: g.rows.map((r) => ({ ...r })) } : g));
  list.render(frameOf(rows));
  expect((document.activeElement as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset["key"]).toBe(key);
  await scrollTo(80 * ROW_H);
  expect(document.activeElement).toBe(el);
  await scrollTo(0);
  expect((document.activeElement as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset["key"]).toBe(key);
});

it("renders every row when the list has no layout", () => {
  const { el, list, rendered } = mount();
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 0 });
  list.render(frameOf(GROUPS));
  expect(rendered()).toHaveLength(102);
});

const focusedKey = (): string | undefined => (document.activeElement as HTMLElement).closest<HTMLElement>("[data-key]")?.dataset["key"];

describe("jump keys", () => {
  function pressAt(index: number, key: string) {
    const m = mount();
    m.rowOf(m.list.reveal(index)!).focus();
    jest.mocked(m.h.onSelect).mockClear();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    return m;
  }

  it("End focuses the last row, which scrolls into the window, and selects its project", () => {
    const { list, h } = pressAt(3, "End");
    expect(focusedKey()).toBe(keyOf(list, 101));
    expect(h.onSelect).toHaveBeenCalledWith("/p/99");
  });

  it("Home focuses the first row and selects its project", () => {
    const { list, h } = pressAt(90, "Home");
    expect(focusedKey()).toBe(keyOf(list, 0));
    expect(h.onSelect).toHaveBeenCalledWith("/p/0");
  });

  it("PageDown moves one viewport minus a row, across the edge of the rendered window", () => {
    const { list, h } = pressAt(12, "PageDown");
    expect(focusedKey()).toBe(keyOf(list, 16));
    expect(h.onSelect).toHaveBeenCalledWith("/p/16");
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    expect(focusedKey()).toBe(keyOf(list, 20));
  });

  it("PageUp moves back one viewport minus a row and stops at the first row", () => {
    const { list } = pressAt(30, "PageUp");
    expect(focusedKey()).toBe(keyOf(list, 26));
    const m = pressAt(2, "PageUp");
    expect(focusedKey()).toBe(keyOf(m.list, 0));
  });

  it("selects nothing when the key lands on a folder header", () => {
    const { list, h } = pressAt(36, "PageDown");
    expect(focusedKey()).toBe("g:A");
    expect(list.rows()[40]!.kind).toBe("group");
    expect(h.onSelect).not.toHaveBeenCalled();
  });

  it("PageDown without layout moves by the rendered rows minus one", () => {
    const m = mount();
    Object.defineProperty(m.el, "clientHeight", { configurable: true, get: () => 0 });
    m.list.render(frameOf(GROUPS));
    m.rowOf(m.list.reveal(0)!).focus();
    document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true, cancelable: true }));
    expect(focusedKey()).toBe(keyOf(m.list, 101));
  });
});

describe("collapsed folders", () => {
  it("expands the folder of a project that becomes selected", () => {
    const { list, el } = mount();
    list.toggleGroup("A");
    expect(list.rows()).toHaveLength(72);
    list.render(frameOf(GROUPS, { selected: "/p/45" }));
    expect(list.rows()).toHaveLength(102);
    expect(list.rows()[40]).toMatchObject({ kind: "group", collapsed: false });
    expect(el.getAttribute("aria-rowcount")).toBe("103");
    expect(list.rows().some((r) => r.key === "p:/p/45")).toBe(true);
  });

  it("keeps a folder collapsed when the selection stays put", () => {
    const { list } = mount();
    list.render(frameOf(GROUPS, { selected: "/p/45" }));
    list.toggleGroup("A");
    list.render(frameOf(GROUPS, { selected: "/p/45" }));
    expect(list.rows()).toHaveLength(72);
  });

  it("moves focus to the header when its folder collapses around the focused project", () => {
    const { list, rowOf } = mount();
    rowOf(list.reveal(41)!).focus();
    expect(focusedKey()).toBe("p:/p/40");
    list.toggleGroup("A");
    expect(focusedKey()).toBe("g:A");
  });
});
