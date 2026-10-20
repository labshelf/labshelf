/**
 * @jest-environment jsdom
 */
// Tests that the host can fold and unfold a sidebar section after mount, with the same persistence as a click.
import { mountLibrarySidebar } from "../../../../src/library-ui/dom";

function mount(collapsed: string[] = []) {
  const actions = { openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), shareFolder: jest.fn(), searchTag: jest.fn() };
  const saveCollapsed = jest.fn();
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const sidebar = mountLibrarySidebar(slot, { actions, expanded: [], saveExpanded: jest.fn(), collapsed, saveCollapsed });
  sidebar.setLibrary([], []);
  return { sidebar, slot, saveCollapsed };
}

const section = (slot: HTMLElement): HTMLElement => slot.querySelector<HTMLElement>('[data-section="library"]')!;

describe("LibrarySidebar.setSectionCollapsed", () => {
  it("collapses a section, updates aria-expanded and persists the collapsed ids", () => {
    const { sidebar, slot, saveCollapsed } = mount();
    sidebar.setSectionCollapsed("library", true);
    expect(section(slot).getAttribute("aria-expanded")).toBe("false");
    expect(saveCollapsed).toHaveBeenCalledWith(["library"]);
  });

  it("expands a collapsed section", () => {
    const { sidebar, slot, saveCollapsed } = mount(["library"]);
    sidebar.setSectionCollapsed("library", false);
    expect(section(slot).getAttribute("aria-expanded")).toBe("true");
    expect(saveCollapsed).toHaveBeenCalledWith([]);
  });

  it("does nothing when the section is already in the requested state", () => {
    const { sidebar, saveCollapsed } = mount(["library"]);
    sidebar.setSectionCollapsed("library", true);
    expect(saveCollapsed).not.toHaveBeenCalled();
  });
});
