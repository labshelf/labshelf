/**
 * @jest-environment jsdom
 */
// Tests folder groups in the rendered list: labels, rowgroup semantics, indent, keyboard order and re-rendering.
import { mountForTest, paper } from "../mountHarness";

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
