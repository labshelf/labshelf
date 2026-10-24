/**
 * Tests paper actions offered by host capabilities.
 * @jest-environment jsdom
 */
import { ALL_CAPABILITIES, menuLabels, mountForTest, paper } from "../mountHarness";

const library = [
  paper("a", "papers", { title: "Alpha", status: "done", textLayer: { state: "missing", checkedAt: "" } }),
  paper("b", "papers", { title: "Beta", status: "done" }),
];

function rightClick(t: ReturnType<typeof mountForTest>, id: string): void {
  const row = t.rows().find((r) => r.dataset["id"] === id)!;
  row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
}

const item = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll<HTMLButtonElement>(".ls-menu-item")].find((b) => b.querySelector(".ls-menu-label")?.textContent === label)!;

describe("paper menu", () => {
  it("offers every action of the host for one paper, continuing at the last page", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, ["papers/a", "papers/b"], [], { a: { annotations: 2, lastPage: 12 } });
    rightClick(t, "a");
    expect(menuLabels()).toEqual([
      "Continue Reading (p. 12)", "Open in Default PDF App",
      "Copy Cite Key", "Copy BibTeX", "Copy APA Reference",
      "Mark as Unread", "Mark as Reading", "Mark as Done",
      "Add Tag…", "Move to…", "Reveal in Explorer", "Make Searchable (OCR)", "Fetch Metadata Online", "Export Annotations…",
      "Remove from Library…",
    ]);
    expect(item("Mark as Done").classList.contains("checked")).toBe(true);
    expect(item("Mark as Unread").classList.contains("checked")).toBe(false);
  });

  it("keeps to the shared actions on a host without capabilities", () => {
    const t = mountForTest();
    t.snapshot(library);
    rightClick(t, "b");
    expect(menuLabels()).toEqual([
      "Open PDF", "Copy Cite Key", "Copy BibTeX", "Copy APA Reference",
      "Mark as Unread", "Mark as Reading", "Mark as Done", "Add Tag…", "Move to…", "Remove from Library…",
    ]);
    expect(item("Open PDF").disabled).toBe(true);
  });

  it("acts on the whole selection", () => {
    const t = mountForTest({}, ALL_CAPABILITIES);
    t.snapshot(library, ["papers/a", "papers/b"]);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    expect(menuLabels()).toContain("Copy 2 Cite Keys");
    expect(menuLabels()).toContain("Make 1 Searchable");
    item("Mark as Reading").click();
    expect(t.sent).toContainEqual({ type: "paper.setStatus", ids: ["a", "b"], status: "reading" });
  });

});

describe("paper menu actions", () => {
  it("asks for tags in a prompt and adds them to the whole selection", async () => {
    const t = mountForTest();
    t.snapshot(library);
    t.lib.store.set({ selected: new Set(["a", "b"]), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    item("Tag 2 Papers…").click();
    const input = document.querySelector<HTMLInputElement>(".ls-quick input")!;
    input.value = "ml, vision";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(t.sent).toContainEqual({ type: "paper.setTags", ids: ["a", "b"], add: ["ml", "vision"], remove: [] });
  });

  it("copies BibTeX built from the records", () => {
    const t = mountForTest();
    t.snapshot(library);
    rightClick(t, "a");
    item("Copy BibTeX").click();
    const copy = t.sent.at(-1) as { type: string; text: string; label: string };
    expect(copy).toMatchObject({ type: "clipboard.write", label: "BibTeX" });
    expect(copy.text).toContain("@article{key-a,");
    expect(copy.text).not.toContain("file =");
  });

  it("opens under the cursor row with the menu key and Shift+F10", () => {
    const t = mountForTest();
    t.snapshot(library);
    t.key("ArrowDown");
    t.key("ContextMenu");
    expect(menuLabels()[0]).toBe("Open PDF");
    t.key("Escape");
    t.key("F10", { shiftKey: true });
    expect(document.querySelector(".ls-menu")).not.toBeNull();
  });
});


describe("Add to Space", () => {
  it.each([["a"], ["a", "b"]])("sends the selected papers %j to the host picker", (...ids: string[]) => {
    const capabilities = { ...ALL_CAPABILITIES, spaces: true };
    const t = mountForTest({}, capabilities);
    t.snapshot(library);
    t.lib.store.set({ selected: new Set(ids), anchor: "a", cursor: "a" });
    rightClick(t, "a");
    expect(menuLabels()).toContain("Add to Space…");
    item("Add to Space…").click();
    expect(t.sent).toContainEqual({ type: "paper.addToSpace", ids });
  });

  it("hides the entry when the capability is disabled", () => {
    const capabilities = { ...ALL_CAPABILITIES, spaces: false };
    const t = mountForTest({}, capabilities);
    t.snapshot(library);
    rightClick(t, "a");
    expect(menuLabels()).not.toContain("Add to Space…");
  });
});
