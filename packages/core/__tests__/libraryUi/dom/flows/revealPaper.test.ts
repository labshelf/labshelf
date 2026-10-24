/**
 * @jest-environment jsdom
 */
// Tests that a host reveal shows a paper wherever it is and reports the selection.
import { mountForTest, paper } from "../mountHarness";

const folders = [
  { name: "A", path: "papers/A", children: [] as [] },
  { name: "B", path: "papers/B", children: [] as [] },
];
const library = [
  paper("r", "papers", { title: "Root paper" }),
  paper("x", "papers/A", { title: "Nested unread", status: "unread" }),
  paper("y", "papers/A", { title: "Nested done", status: "done" }),
];

describe("reveal", () => {
  it("opens the folder of a paper held in another folder, selects it and opens it", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.openFolder("papers/B");
    t.host.post({ type: "reveal", id: "x" });
    const s = t.lib.store.get();
    expect(s.folder).toBe("papers/A");
    expect([...s.selected]).toEqual(["x"]);
    expect(s.open).toBe("x");
    expect(t.rowIds()).toContain("x");
  });

  it("keeps an open scope that holds the paper", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "reveal", id: "x" });
    expect(t.lib.store.get()).toMatchObject({ folder: "papers", open: "x" });
    expect(t.rowIds()).toContain("x");
  });

  it("clears a search that hides the paper", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.openFolder("papers/A");
    t.lib.store.set({ query: "done" });
    t.host.post({ type: "reveal", id: "x" });
    expect(t.lib.store.get().query).toBe("");
    expect(t.rowIds()).toContain("x");
  });

  it("leaves other selected papers out: the revealed paper is the only selection", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.set({ selected: new Set(["r", "y"]) });
    t.host.post({ type: "reveal", id: "r" });
    expect([...t.lib.store.get().selected]).toEqual(["r"]);
    expect(t.lib.store.get().open).toBe("r");
  });

  it("changes nothing for an unknown id", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.set({ query: "q", selected: new Set(["r"]) });
    const before = t.lib.store.get();
    t.host.post({ type: "reveal", id: "ghost" });
    const after = t.lib.store.get();
    expect(after).toMatchObject({ folder: before.folder, query: "q", open: null });
    expect([...after.selected]).toEqual(["r"]);
  });
});

describe("paper.selected", () => {
  const selectedPosts = (t: ReturnType<typeof mountForTest>) => t.sent.filter((m) => m.type === "paper.selected");

  it("posts every selected id, and an empty list when none is selected", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.selectOnly("r");
    expect(selectedPosts(t).at(-1)).toEqual({ type: "paper.selected", ids: ["r"] });
    t.lib.store.toggleSelected("x");
    expect(selectedPosts(t).at(-1)).toEqual({ type: "paper.selected", ids: ["r", "x"] });
    t.lib.store.selectOnly("x");
    expect(selectedPosts(t).at(-1)).toEqual({ type: "paper.selected", ids: ["x"] });
    t.lib.store.clearSelection();
    expect(selectedPosts(t).at(-1)).toEqual({ type: "paper.selected", ids: [] });
  });

  it("does not repeat a post for the same value", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.lib.store.selectOnly("r");
    const count = selectedPosts(t).length;
    t.lib.store.selectOnly("r");
    expect(selectedPosts(t)).toHaveLength(count);
    t.lib.store.set({ selected: new Set(["r", "x"]) });
    t.lib.store.set({ selected: new Set(["r", "x"]) });
    expect(selectedPosts(t)).toHaveLength(count + 1);
  });

  it("reports a paper selected by a host reveal", () => {
    const t = mountForTest();
    t.snapshot(library, [], folders);
    t.host.post({ type: "reveal", id: "x" });
    expect(selectedPosts(t).at(-1)).toEqual({ type: "paper.selected", ids: ["x"] });
  });
});
