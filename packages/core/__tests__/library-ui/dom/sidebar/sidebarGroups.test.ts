/**
 * @jest-environment jsdom
 */
// Tests the collapsible Folders and Tags headings of the Library section: click, keyboard, persistence and the folder tree's own expansion.
import { mountLibrarySidebar } from "../../../../src/library-ui/dom";

const folders = [{ name: "A", path: "papers/A", children: [] }];
const papers = [{ record: { id: "t1", title: "one", status: "done" as const, tags: ["NLP"] }, folder: "papers/A" }];

function mount(expanded: string[] = [], collapsed: string[] = []) {
  const actions = { openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() };
  const saveExpanded = jest.fn();
  const saveCollapsed = jest.fn();
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const sidebar = mountLibrarySidebar(slot, { actions, expanded, saveExpanded, collapsed, saveCollapsed });
  sidebar.setLibrary(folders, papers);
  return { slot, saveCollapsed };
}

const group = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-group="${id}"]`)!;
const hasFolder = (slot: HTMLElement): boolean => slot.querySelector('[data-path="papers/A"]') !== null;
const hasTag = (slot: HTMLElement): boolean => slot.querySelector('[data-tag="NLP"]') !== null;
const key = (slot: HTMLElement, k: string): void => { slot.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
const focusGroup = (slot: HTMLElement, id: string): void => {
  slot.focus();
  const rows = [...slot.querySelectorAll<HTMLElement>(".tree-row, .tree-section, .tree-group")];
  const target = rows.findIndex((r) => r === group(slot, id));
  for (let i = 0; i <= target; i++) key(slot, i === 0 ? "Home" : "ArrowDown");
};

describe("collapsible Folders and Tags headings", () => {
  // jsdom has no scrollIntoView, which the focused row calls.
  beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

  it("opens both groups by default, with a chevron and aria-expanded", () => {
    const { slot } = mount();
    expect(group(slot, "library.folders").getAttribute("aria-expanded")).toBe("true");
    expect(group(slot, "library.tags").getAttribute("aria-expanded")).toBe("true");
    expect(group(slot, "library.folders").querySelector(".tree-section-chevron svg")).not.toBeNull();
    expect(hasFolder(slot) && hasTag(slot)).toBe(true);
  });

  it("renders Folders and Tags as panes nested in the Library body, each with its own body", () => {
    const { slot } = mount();
    const library = slot.querySelector<HTMLElement>('[data-pane="library"]')!;
    const stack = library.querySelector<HTMLElement>(".tree-pane-stack")!;
    expect([...stack.children].map((c) => (c as HTMLElement).dataset["pane"] ?? "all-papers")).toEqual(["all-papers", "library.folders", "library.tags"]);
    for (const id of ["library.folders", "library.tags"]) {
      const pane = stack.querySelector<HTMLElement>(`[data-pane="${id}"]`)!;
      expect(pane.classList.contains("open")).toBe(true);
      expect(pane.firstElementChild).toBe(group(slot, id));
      expect(pane.lastElementChild!.classList.contains("tree-pane-body")).toBe(true);
    }
    expect(stack.querySelector('[data-pane="library.folders"] [data-path="papers/A"]')).not.toBeNull();
    expect(stack.querySelector('[data-pane="library.tags"] [data-tag="NLP"]')).not.toBeNull();
  });

  it("closes a nested pane to its header alone and omits Tags when the library has none", () => {
    const { slot } = mount([], ["library.tags"]);
    const tags = slot.querySelector('[data-pane="library.tags"]')!;
    expect(tags.classList.contains("open")).toBe(false);
    expect(tags.querySelector(".tree-pane-body")!.children).toHaveLength(0);
    const bare = document.createElement("div");
    const sidebar = mountLibrarySidebar(bare, { actions: {} as never, expanded: [], saveExpanded: jest.fn(), collapsed: [], saveCollapsed: jest.fn() });
    sidebar.setLibrary(folders, [{ record: { id: "t2", title: "two", status: "done" as const, tags: [] }, folder: "papers/A" }]);
    expect(bare.querySelector('[data-pane="library.tags"]')).toBeNull();
    expect(bare.querySelector('[data-pane="library.folders"]')).not.toBeNull();
  });

  it("hides the folder rows when the Folders heading is clicked and saves the key", () => {
    const { slot, saveCollapsed } = mount();
    group(slot, "library.folders").click();
    expect(hasFolder(slot)).toBe(false);
    expect(hasTag(slot)).toBe(true);
    expect(group(slot, "library.folders").getAttribute("aria-expanded")).toBe("false");
    expect(saveCollapsed).toHaveBeenLastCalledWith(["library.folders"]);
    group(slot, "library.folders").click();
    expect(hasFolder(slot)).toBe(true);
    expect(saveCollapsed).toHaveBeenLastCalledWith([]);
  });

  it("hides the tag rows when the Tags heading is clicked and saves the key", () => {
    const { slot, saveCollapsed } = mount();
    group(slot, "library.tags").click();
    expect(hasTag(slot)).toBe(false);
    expect(hasFolder(slot)).toBe(true);
    expect(saveCollapsed).toHaveBeenLastCalledWith(["library.tags"]);
  });

  it("keeps the folder tree's own expansion while Folders is collapsed", () => {
    const { slot } = mount(["papers/A"]);
    expect(slot.querySelector('[data-id="t1"]')).not.toBeNull();
    group(slot, "library.folders").click();
    group(slot, "library.folders").click();
    expect(slot.querySelector('[data-id="t1"]')).not.toBeNull();
  });

  it("toggles from the keyboard: Enter, ArrowLeft collapses, ArrowRight expands", () => {
    const { slot, saveCollapsed } = mount();
    focusGroup(slot, "library.tags");
    key(slot, "Enter");
    expect(hasTag(slot)).toBe(false);
    key(slot, "ArrowRight");
    expect(hasTag(slot)).toBe(true);
    key(slot, "ArrowLeft");
    expect(hasTag(slot)).toBe(false);
    expect(saveCollapsed).toHaveBeenLastCalledWith(["library.tags"]);
    key(slot, " ");
    expect(hasTag(slot)).toBe(true);
  });

  it("restores the collapsed state on remount", () => {
    const { slot } = mount([], ["library.folders", "library.tags"]);
    expect(hasFolder(slot) || hasTag(slot)).toBe(false);
    expect(group(slot, "library.folders").getAttribute("aria-expanded")).toBe("false");
    expect(group(slot, "library.tags").getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the Folders hover actions working while collapsed", () => {
    const { slot } = mount([], ["library.folders"]);
    expect(group(slot, "library.folders").querySelector('[data-tree="new"]')).not.toBeNull();
  });
});
