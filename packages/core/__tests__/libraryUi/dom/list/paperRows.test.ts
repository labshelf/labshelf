/**
 * @jest-environment jsdom
 */
// Tests the rows of the paper list: grouping by folder and its labels, the rendered groups, and the list keys.
import type { ListPaper } from "../../../../src/libraryUi/listModel";
import { deriveGroupLabel, derivePaperGroups } from "../../../../src/libraryUi/dom/list/paperRows";
import { mountForTest, paper } from "../mountHarness";

function row(id: string, rel: string): ListPaper {
  const folderPath = rel === "" ? "papers/ml" : `papers/ml/${rel.split(" / ").join("/")}`;
  return { id, title: id, path: `${folderPath}/${id}`, citeKey: id, status: "unread", folderPath, relFolder: rel, hasPdf: true };
}
const ids = (g: { papers: ListPaper[] }): string[] => g.papers.map((p) => p.id);

describe("groupPapers", () => {
  it("returns no groups for no rows", () => {
    expect(derivePaperGroups([], "papers/ml")).toEqual([]);
  });

  it("returns only the own group, with no segments, when every paper sits directly in the folder", () => {
    const groups = derivePaperGroups([row("a", ""), row("b", "")], "papers/ml");
    expect(groups).toHaveLength(1);
    expect(groups[0]!.segments).toEqual([]);
    expect(ids(groups[0]!)).toEqual(["a", "b"]);
  });

  it("puts the own group first and omits it when it has no papers", () => {
    const mixed = derivePaperGroups([row("s", "sub"), row("o", "")], "papers/ml");
    expect(mixed.map((g) => g.segments)).toEqual([[], ["sub"]]);
    const onlySub = derivePaperGroups([row("s", "sub")], "papers/ml");
    expect(onlySub.map((g) => g.segments)).toEqual([["sub"]]);
  });

  it("orders subgroups by locale path and keeps the sort order inside each group", () => {
    const rows = [row("z1", "zeta"), row("d1", "alpha / deep"), row("a1", "alpha"), row("z2", "zeta"), row("a2", "alpha")];
    const groups = derivePaperGroups(rows, "papers/ml");
    expect(groups.map((g) => g.segments)).toEqual([["alpha"], ["alpha", "deep"], ["zeta"]]);
    expect(groups.map(ids)).toEqual([["a1", "a2"], ["d1"], ["z1", "z2"]]);
  });

  it("gives every group a distinct key", () => {
    const groups = derivePaperGroups([row("o", ""), row("a", "alpha"), row("b", "beta")], "papers/ml");
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it("groups by folder relative to the root for the All papers scope", () => {
    const rows = [row("n", "")].map((r) => ({ ...r, folderPath: "papers", relFolder: "", path: "papers/n" }));
    const sub = { ...row("m", "ml"), folderPath: "papers/ml", relFolder: "ml", path: "papers/ml/m" };
    const groups = derivePaperGroups([...rows, sub], "papers");
    expect(groups.map((g) => g.segments)).toEqual([[], ["ml"]]);
  });
});

describe("groupLabel", () => {
  it("joins up to three segments with a separator and repeats them in the title", () => {
    expect(deriveGroupLabel(["a"])).toEqual({ shown: [0], title: "a" });
    expect(deriveGroupLabel(["a", "b", "c"])).toEqual({ shown: [0, 1, 2], title: "a › b › c" });
  });

  it("collapses more than three segments to first, ellipsis, second-last and last", () => {
    expect(deriveGroupLabel(["a", "b", "c", "d"])).toEqual({ shown: [0, 2, 3], title: "a › b › c › d" });
    expect(deriveGroupLabel(["a", "b", "c", "d", "e"])).toEqual({ shown: [0, 3, 4], title: "a › b › c › d › e" });
  });
});

const library = [
  paper("own1", "papers/ml", { title: "A own" }),
  paper("own2", "papers/ml", { title: "B own" }),
  paper("d1", "papers/ml/deep", { title: "C deep" }),
  paper("d2", "papers/ml/deep", { title: "D deep" }),
  paper("r1", "papers/ml/rl/policy", { title: "E rl" }),
];
const PDFS = library.map((p) => p.path);
type T = ReturnType<typeof mountForTest>;

function mounted(prefs: Parameters<typeof mountForTest>[0] = {}): T {
  const t = mountForTest({ sortKey: "title", sortDir: 1, ...prefs });
  t.snapshot(library, PDFS);
  t.lib.store.set({ folder: "papers/ml" });
  return t;
}
const groups = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>('[role="rowgroup"][aria-label]')];
const labels = (t: T): HTMLElement[] => [...t.container.querySelectorAll<HTMLElement>(".group-label")];
const before = (a: Node, b: Node): boolean => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("folder groups in a folder scope", () => {
  it("lists the own papers first with no label in front of them", () => {
    const t = mounted();
    expect(t.rowIds()).toEqual(["own1", "own2", "d1", "d2", "r1"]);
    const firstLabel = labels(t)[0]!;
    for (const id of ["own1", "own2"]) expect(before(t.rows().find((r) => r.dataset["id"] === id)!, firstLabel)).toBe(true);
    expect(labels(t)).toHaveLength(2);
  });

  it("makes each subfolder a rowgroup named by its full path and paper count", () => {
    const t = mounted();
    expect(groups(t).map((g) => g.getAttribute("aria-label"))).toEqual(["deep, 2 papers", "rl › policy, 1 paper"]);
    expect(groups(t)[0]!.querySelectorAll(".paper-row")).toHaveLength(2);
  });

  it("shows a hidden visible label with the path segments, without the count, that is not a row", () => {
    const t = mounted();
    const label = labels(t)[1]!;
    expect(label.getAttribute("aria-hidden")).toBe("true");
    expect(label.getAttribute("role")).not.toBe("row");
    expect(label.closest('[role="row"]')).toBeNull();
    expect(label.textContent).toContain("rl");
    expect(label.textContent).toContain("policy");
    expect(label.textContent).not.toContain("1");
    expect(label.hasAttribute("tabindex")).toBe(false);
  });

  it("indents subgroup paper rows and leaves own rows flush", () => {
    const t = mounted();
    const byId = (id: string): HTMLElement => t.rows().find((r) => r.dataset["id"] === id)!;
    expect(byId("own1").classList.contains("in-group")).toBe(false);
    expect(byId("d1").classList.contains("in-group")).toBe(true);
    expect(byId("r1").classList.contains("in-group")).toBe(true);
  });

  it("walks ArrowDown from the last own paper into the first subgroup paper without stopping on a label", () => {
    const t = mounted();
    t.lib.store.set({ selected: new Set(["own2"]), anchor: "own2", cursor: "own2" });
    t.key("ArrowDown");
    expect(t.lib.store.get().cursor).toBe("d1");
    t.key("ArrowDown");
    t.key("ArrowDown");
    expect(t.lib.store.get().cursor).toBe("r1");
    const active = document.activeElement as HTMLElement | null;
    expect(active?.closest(".group-label")).toBeNull();
    expect(labels(t).some((l) => l.contains(active))).toBe(false);
  });

  it("collapses a path of more than three segments in the label and keeps the full path in the title", () => {
    const t = mountForTest({ sortKey: "title", sortDir: 1 });
    const deep = paper("x", "papers/ml/a/b/c/d", { title: "X" });
    t.snapshot([deep], [deep.path]);
    t.lib.store.set({ folder: "papers/ml" });
    const label = labels(t)[0]!;
    expect([...label.querySelectorAll(".group-parent, .group-gap, .group-last")].map((e) => e.textContent)).toEqual(["a", "…", "c", "d"]);
    expect([label, ...label.querySelectorAll("[title]")].some((e) => e.getAttribute("title") === "a › b › c › d")).toBe(true);
    expect(groups(t)[0]!.getAttribute("aria-label")).toBe("a › b › c › d, 1 paper");
  });

  it("opens the folder of a clicked label segment", () => {
    const t = mountForTest({ sortKey: "title", sortDir: 1 });
    const deep = paper("x", "papers/ml/a/b", { title: "X" });
    t.snapshot([deep], [deep.path]);
    t.lib.store.set({ folder: "papers/ml" });
    labels(t)[0]!.querySelector<HTMLElement>(".group-parent")!.click();
    expect(t.lib.store.get().folder).toBe("papers/ml/a");
  });
});

describe("folder groups across scopes", () => {
  it("groups All papers by folder relative to the root, root papers first", () => {
    const t = mounted();
    const top = paper("top", "papers", { title: "0 top" });
    t.snapshot([...library, top], [...PDFS, top.path]);
    t.lib.store.set({ folder: "papers" });
    expect(t.rowIds()).toEqual(["top", "own1", "own2", "d1", "d2", "r1"]);
    expect(groups(t).map((g) => g.getAttribute("aria-label"))).toEqual(["ml, 2 papers", "ml › deep, 2 papers", "ml › rl › policy, 1 paper"]);
  });

  it("keeps grouping while a search narrows the list", () => {
    const t = mounted();
    t.lib.store.set({ query: "deep" });
    expect(t.rowIds()).toEqual(["d1", "d2"]);
    expect(groups(t).map((g) => g.getAttribute("aria-label"))).toEqual(["deep, 2 papers"]);
  });
});

describe("re-rendering groups", () => {
  it("adds no duplicate labels or rows after a snapshot change", () => {
    const t = mounted();
    t.snapshot(library, PDFS);
    t.snapshot([...library, paper("d3", "papers/ml/deep", { title: "F deep" })], [...PDFS, "papers/ml/deep/d3"]);
    expect(t.rowIds()).toEqual(["own1", "own2", "d1", "d2", "d3", "r1"]);
    expect(labels(t)).toHaveLength(2);
    expect(groups(t).map((g) => g.getAttribute("aria-label"))).toEqual(["deep, 3 papers", "rl › policy, 1 paper"]);
  });
});

const libraryListShortcuts = [paper("a", "papers", { title: "Alpha" }), paper("b", "papers", { title: "Beta" }), paper("c", "papers", { title: "Gamma" })];

function selected(t: ReturnType<typeof mountForTest>, ...ids: string[]): void {
  t.snapshot(libraryListShortcuts);
  t.lib.store.set({ selected: new Set(ids), anchor: ids[0] ?? null, cursor: ids[0] ?? null });
}

const dialogOpen = (): boolean => document.querySelector(".ls-scrim") !== null;

describe("list keys", () => {
  it("a plain Backspace removes nothing", () => {
    const t = mountForTest();
    selected(t, "a");
    t.key("Backspace");
    expect(dialogOpen()).toBe(false);
  });

  it.each([["Delete", {}], ["Backspace", { metaKey: true }], ["Backspace", { ctrlKey: true }]])("%s %j asks before removing the selection", (k, mods) => {
    const t = mountForTest();
    selected(t, "a");
    t.key(k, mods);
    expect(dialogOpen()).toBe(true);
    expect(document.querySelector(".ls-dialog-title")?.textContent).toBe('Remove "Alpha" from the library?');
    t.key("Escape");
    expect(dialogOpen()).toBe(false);
  });

  it("Alt+2 marks the selection as Reading at once and tells the host", () => {
    const t = mountForTest();
    selected(t, "a", "c");
    t.key("™", { altKey: true, code: "Digit2" });
    expect(t.sent).toContainEqual({ type: "paper.setStatus", ids: ["a", "c"], status: "reading" });
    expect(t.lib.store.get().papers.map((p) => p.status)).toEqual(["reading", "unread", "reading"]);
  });

  it("Cmd/Ctrl+C copies the selected cite keys joined by commas", () => {
    const t = mountForTest();
    selected(t, "c", "a");
    t.key("c", { ctrlKey: true });
    expect(t.sent).toContainEqual({ type: "clipboard.write", text: "key-a,key-c", label: "2 × cite key" });
  });

  it("Cmd/Ctrl+C with nothing selected leaves the clipboard alone", () => {
    const t = mountForTest();
    t.snapshot(libraryListShortcuts);
    t.key("c", { metaKey: true });
    expect(t.sent.some((m) => m.type === "clipboard.write")).toBe(false);
  });

  it("Escape clears the filters first, then the selection", () => {
    const t = mountForTest();
    selected(t, "a");
    t.lib.store.set({ query: "alpha" });
    t.key("Escape");
    expect(t.lib.store.get()).toMatchObject({ query: "" });
    expect(t.lib.store.get().selected.size).toBe(1);
    t.key("Escape");
    expect(t.lib.store.get().selected.size).toBe(0);
  });

  it("arrows move the selection and Enter opens the paper", () => {
    const t = mountForTest();
    t.snapshot(libraryListShortcuts);
    t.key("ArrowDown");
    t.key("ArrowDown");
    expect([...t.lib.store.get().selected]).toEqual(["b"]);
    t.key("Enter");
    expect(t.sent).toContainEqual({ type: "paper.open", id: "b" });
  });
});
