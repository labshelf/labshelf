/**
 * @jest-environment jsdom
 */
import { mountForTest, paper } from "../mountHarness";

const library = [paper("a", "papers", { title: "Alpha" }), paper("b", "papers", { title: "Beta" }), paper("c", "papers", { title: "Gamma" })];

function selected(t: ReturnType<typeof mountForTest>, ...ids: string[]): void {
  t.snapshot(library);
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
    t.snapshot(library);
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
    t.snapshot(library);
    t.key("ArrowDown");
    t.key("ArrowDown");
    expect([...t.lib.store.get().selected]).toEqual(["b"]);
    t.key("Enter");
    expect(t.sent).toContainEqual({ type: "paper.open", id: "b" });
  });
});
