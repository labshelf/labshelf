/**
 * @jest-environment jsdom
 */
// Tests the paper flows through the mounted library UI: the remove confirmation and revealing a paper.
import { mountForTest, paper } from "../mountHarness";

describe("confirm before remove", () => {
  it("asks once, then clears the selection and asks the host to remove", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers", { title: "Alpha" }), paper("b", "papers")], ["papers/a"]);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    t.key("Delete");
    expect(document.querySelector(".ls-dialog-title")?.textContent).toBe("Remove 2 papers from the library?");
    expect(document.querySelector(".ls-dialog-msg")?.textContent).toBe("Their folders and files are deleted from the library on this device and on every synced device.");
    [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === "Remove")!.click();
    await Promise.resolve();
    expect(t.sent.at(-1)).toEqual({ type: "paper.remove", ids: ["a", "b"] });
    expect(t.lib.store.get().selected.size).toBe(0);
  });

  it("removes nothing when the dialog is cancelled", async () => {
    const t = mountForTest();
    t.snapshot([paper("a", "papers")]);
    t.lib.store.set({ selected: new Set(["a"]), anchor: "a", cursor: "a" });
    t.key("Delete");
    [...document.querySelectorAll<HTMLButtonElement>(".ls-dialog button")].find((b) => b.textContent === "Cancel")!.click();
    await Promise.resolve();
    expect(t.sent.some((m) => m.type === "paper.remove")).toBe(false);
    expect(t.lib.store.get().selected.size).toBe(1);
  });
});

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
