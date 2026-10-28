/**
 * @jest-environment jsdom
 */
// Tests the library sidebar through its mount handle: rows, counts, expansion, current folder, selection and keyboard.
import { fakeHost, tick } from "../../../collab/dom/fakeHost";
import type { ShareHost } from "../../../../src/share/index";
import { mountLibrarySidebar } from "../../../../src/libraryUi/dom";
import { compact, folder, folders, key, mount, rows, tagged } from "./sidebarFixture";

const section = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
const allPapers = (slot: HTMLElement): HTMLElement => slot.querySelector<HTMLElement>("[data-all-papers]")!;
const paperEl = (slot: HTMLElement, id: string): HTMLElement | null => slot.querySelector<HTMLElement>(`[data-id="${id}"]`);
const order = (slot: HTMLElement): string[] => rows(slot).slice(1).map((r) => r.dataset["path"] ?? r.dataset["id"] ?? "");
const twisty = (slot: HTMLElement, path: string): void => folder(slot, path).querySelector<HTMLElement>(".tree-twisty")!.click();

describe("mountLibrarySidebar", () => {
  describe("folder menu", () => {
    const menuText = (sharing?: ShareHost): string => {
      const { slot } = mount([], [], false, false, sharing);
      folder(slot, "papers/A").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return document.body.textContent ?? "";
    };

    it("offers Share as Link only when the host offers links", () => {
      expect(menuText(fakeHost())).toContain("Share as Link");
      expect(menuText(fakeHost({ offers: () => ({ projects: true, links: false }) }))).not.toContain("Share as Link");
      expect(menuText()).not.toContain("Share as Link");
      expect(menuText()).toContain("Rename");
    });

    it("runs the share dialog for the folder", async () => {
      const host = fakeHost();
      const { slot } = mount([], [], false, false, host);
      folder(slot, "papers/A").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      [...document.querySelectorAll<HTMLElement>(".ls-menu-item")].find((i) => i.textContent?.includes("Share as Link"))!.click();
      await tick();
      expect(host.shareableFolder).toHaveBeenCalledWith("papers/A");
    });
  });

  it("offers the shared-link entries on the Library heading only when the host offers links", () => {
    const heading = (sharing?: ShareHost): string => {
      const { slot } = mount([], [], false, false, sharing);
      slot.querySelector('[data-section="library"]')!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      return document.body.textContent ?? "";
    };
    expect(heading(fakeHost())).toContain("Manage Shared Links");
    expect(heading(fakeHost())).toContain("Import Shared Link");
    expect(heading(fakeHost({ offers: () => ({ projects: true, links: false }) }))).not.toContain("Shared Link");
  });

  it("shows the All papers row first, with the paper count", () => {
    const { slot } = mount();
    expect(compact(rows(slot)[0]!)).toMatch(/^Allpapers5/);
    expect(rows(slot).some((r) => r.dataset["scope"] !== undefined)).toBe(false);
  });

  it("places the Library section header first and the Folders heading between All papers and folders", () => {
    const { slot } = mount();
    const [library, foldersHeading] = [...slot.querySelectorAll(".tree-heading")];
    expect(library?.textContent).toBe("Library");
    expect(library?.getAttribute("data-section")).toBe("library");
    expect(library?.nextElementSibling?.firstElementChild?.hasAttribute("data-all-papers")).toBe(true);
    expect(foldersHeading?.textContent).toBe("Folders");
    expect(foldersHeading?.parentElement?.previousElementSibling?.hasAttribute("data-all-papers")).toBe(true);
    expect(foldersHeading?.nextElementSibling?.firstElementChild?.getAttribute("data-path")).toBe("papers/A");
  });

  it("lists top-level folders then root papers, with recursive counts and a twisty but no folder icon", () => {
    const { slot } = mount();
    expect(order(slot)).toEqual(["papers/A", "papers/Z", "r1"]);
    expect(compact(folder(slot, "papers/A"))).toMatch(/^A4/);
    expect(folder(slot, "papers/A").querySelector(".tree-twisty")).not.toBeNull();
    expect(folder(slot, "papers/A").querySelector(".tree-icon")).toBeNull();
    expect(folder(slot, "papers/A").getAttribute("aria-expanded")).toBe("false");
  });

  it("shows a paper as a REF label and title behind an empty twisty slot", () => {
    const { slot } = mount();
    const row = paperEl(slot, "r1")!;
    expect(row.querySelector(".tree-ref")?.textContent).toBe("REF");
    expect(row.textContent).toMatch(/REF\s*zeta root/);
    expect(row.querySelector(".tree-twisty")?.classList.contains("leaf")).toBe(true);
  });

  it("expands a folder with subfolders first, then its papers by title", () => {
    const { slot } = mount();
    twisty(slot, "papers/A");
    expect(order(slot)).toEqual(["papers/A", "papers/A/B", "a2", "a1", "papers/Z", "r1"]);
  });

  it("opens the library root from All papers, marks it current and clears the folder mark", () => {
    const { slot, actions } = mount();
    folder(slot, "papers/Z").click();
    allPapers(slot).click();
    expect(actions.openFolder).toHaveBeenLastCalledWith("papers");
    expect(allPapers(slot).classList.contains("current")).toBe(true);
    expect(folder(slot, "papers/Z").classList.contains("current")).toBe(false);
  });

  it("opens a folder, marks it current and expands a collapsed parent", () => {
    const { slot, actions } = mount();
    folder(slot, "papers/A").click();
    expect(actions.openFolder).toHaveBeenCalledWith("papers/A");
    expect(folder(slot, "papers/A").classList.contains("current")).toBe(true);
    expect(folder(slot, "papers/A").getAttribute("aria-expanded")).toBe("true");
    expect(folder(slot, "papers/A/B")).not.toBeNull();
  });

  it("reveals a paper through the host when its row is clicked", () => {
    const { slot, actions } = mount();
    paperEl(slot, "r1")!.click();
    expect(actions.revealPaper).toHaveBeenCalledWith("r1");
  });

  it("marks the selected paper and expands its ancestors; null clears the mark", () => {
    const { slot, sidebar } = mount();
    expect(paperEl(slot, "b1")).toBeNull();
    sidebar.setSelected("b1");
    expect(paperEl(slot, "b1")!.getAttribute("aria-selected")).toBe("true");
    expect(folder(slot, "papers/A/B").getAttribute("aria-expanded")).toBe("true");
    sidebar.setSelected(null);
    expect(slot.querySelector("[data-id][aria-selected='true']")).toBeNull();
  });

  it("saves the expansion on a twisty click and restores it on remount", () => {
    const first = mount();
    twisty(first.slot, "papers/A");
    expect(first.saveExpanded).toHaveBeenLastCalledWith(["papers/A"]);
    const second = mount(["papers/A"]);
    expect(paperEl(second.slot, "a1")).not.toBeNull();
  });

  it("collapses everything and saves an empty list", () => {
    const { slot, saveExpanded } = mount(["papers/A"]);
    expect(paperEl(slot, "a1")).not.toBeNull();
    slot.querySelector<HTMLElement>("[data-tree='collapse']")!.click();
    expect(saveExpanded).toHaveBeenLastCalledWith([]);
    expect(paperEl(slot, "a1")).toBeNull();
  });

  it("creates a folder at the root from the Folders heading", () => {
    const { slot, actions } = mount();
    slot.querySelector<HTMLElement>("[data-tree='new']")!.click();
    expect(actions.createFolder).toHaveBeenLastCalledWith("papers");
    expect(actions.openFolder).not.toHaveBeenCalled();
  });

  describe("target of New folder and Add files", () => {
    const newFolder = (slot: HTMLElement): void => slot.querySelector<HTMLElement>("[data-tree='new']")!.click();
    const addFiles = (slot: HTMLElement): HTMLElement | null => slot.querySelector<HTMLElement>("[data-tree='add-files']");

    it("creates in the folder last clicked", () => {
      const { slot, actions } = mount();
      folder(slot, "papers/Z").click();
      newFolder(slot);
      expect(actions.createFolder).toHaveBeenLastCalledWith("papers/Z");
    });

    it("creates in the folder of a clicked paper", () => {
      const { slot, actions } = mount(["papers/A"]);
      paperEl(slot, "a1")!.click();
      newFolder(slot);
      expect(actions.createFolder).toHaveBeenLastCalledWith("papers/A");
    });

    it("creates at the root after All papers is clicked", () => {
      const { slot, actions } = mount();
      folder(slot, "papers/Z").click();
      allPapers(slot).click();
      newFolder(slot);
      expect(actions.createFolder).toHaveBeenLastCalledWith("papers");
    });

    it("follows setCurrent", () => {
      const { slot, sidebar, actions } = mount();
      sidebar.setCurrent("papers/A/B");
      newFolder(slot);
      expect(actions.createFolder).toHaveBeenLastCalledWith("papers/A/B");
    });

    it("has no Add files button without the addFiles action", () => {
      expect(addFiles(mount().slot)).toBeNull();
    });

    it("adds files into the target when the host provides addFiles", () => {
      const { slot, actions } = mount([], [], false, true);
      folder(slot, "papers/Z").click();
      addFiles(slot)!.click();
      expect((actions as { addFiles: jest.Mock }).addFiles).toHaveBeenCalledWith("papers/Z");
    });

    it("keeps the Projects header's Add existing folder separate from Add files", () => {
      const { slot, projects, actions } = mount([], [], true, true);
      section(slot, "projects").parentElement!.querySelector<HTMLElement>('.tree-empty-actions [data-tree="add"]')!.click();
      expect(projects.addExisting).toHaveBeenCalledTimes(1);
      expect((actions as { addFiles: jest.Mock }).addFiles).not.toHaveBeenCalled();
    });
  });

  it("shows a twisty with aria-expanded on an empty folder and expands it from the keyboard", () => {
    const { slot } = mount();
    const row = folder(slot, "papers/Z");
    expect(row.querySelector(".tree-twisty")?.classList.contains("leaf")).toBe(false);
    expect(row.getAttribute("aria-expanded")).toBe("false");
    folder(slot, "papers/Z").click();
    expect(folder(slot, "papers/Z").getAttribute("aria-expanded")).toBe("true");
    key(slot, "ArrowLeft");
    expect(folder(slot, "papers/Z").getAttribute("aria-expanded")).toBe("false");
    key(slot, "ArrowRight");
    expect(folder(slot, "papers/Z").getAttribute("aria-expanded")).toBe("true");
  });

  it("moves with ArrowDown and activates with Enter", () => {
    const { slot, actions } = mount();
    key(slot, "ArrowDown");
    key(slot, "ArrowDown");
    key(slot, "Enter");
    expect(actions.openFolder).toHaveBeenCalledWith("papers/A");
  });

  it("renames the focused folder on F2", () => {
    const { slot, actions } = mount();
    folder(slot, "papers/Z").click();
    key(slot, "F2");
    expect(actions.renameFolder).toHaveBeenCalledWith("papers/Z");
  });

  it("expands the parents of the current folder and marks it", () => {
    const { slot, sidebar } = mount();
    sidebar.setCurrent("papers/A/B");
    expect(folder(slot, "papers/A").getAttribute("aria-expanded")).toBe("true");
    expect(folder(slot, "papers/A/B").classList.contains("current")).toBe(true);
  });

  describe("sections", () => {
    it("toggles the Library section from its header and saves the collapsed ids", () => {
      const { slot, saveCollapsed } = mount();
      expect(section(slot, "library").getAttribute("aria-expanded")).toBe("true");
      section(slot, "library").click();
      expect(saveCollapsed).toHaveBeenLastCalledWith(["library"]);
      expect(section(slot, "library").getAttribute("aria-expanded")).toBe("false");
      expect(rows(slot)).toHaveLength(0);
      section(slot, "library").click();
      expect(saveCollapsed).toHaveBeenLastCalledWith([]);
      expect(rows(slot)).toHaveLength(4);
    });

    it("starts with the collapsed sections from the options hidden", () => {
      const { slot } = mount([], ["library", "projects"], true);
      expect(rows(slot)).toHaveLength(0);
      expect([...slot.querySelectorAll(".tree-section")].map((h) => h.getAttribute("aria-expanded"))).toEqual(["false", "false"]);
      expect([...slot.children].map((c) => c.textContent)).toEqual(["Library", "Projects"]);
    });

    it("toggles a section from the keyboard", () => {
      const { slot, saveCollapsed } = mount();
      key(slot, "Home");
      key(slot, "ArrowLeft");
      expect(saveCollapsed).toHaveBeenLastCalledWith(["library"]);
      key(slot, "Enter");
      expect(saveCollapsed).toHaveBeenLastCalledWith([]);
    });

    it("has no Projects section without the projects option", () => {
      const { slot } = mount();
      expect(section(slot, "projects")).toBeNull();
    });
  });


  describe("tags", () => {
    const headings = (slot: HTMLElement): string[] => [...slot.querySelectorAll(".tree-heading:not(.tree-section)")].map((h) => h.textContent!.trim());
    const tagRows = (slot: HTMLElement): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".tree-row[data-tag]")];

    it("has no Tags heading while no paper has a tag", () => {
      const { slot } = mount();
      expect(headings(slot)).toEqual(["Folders"]);
    });

    it("lists each tag A to Z with a muted # and its count, under a Tags heading below Folders", () => {
      const { slot, sidebar } = mount([], [], true);
      sidebar.setLibrary(folders, tagged);
      expect([...slot.querySelectorAll(".tree-section")].map((h) => h.getAttribute("data-section"))).toEqual(["library", "projects"]);
      expect(headings(slot)).toEqual(["Folders", "Tags", "My projects"]);
      expect(tagRows(slot).map((r) => compact(r))).toEqual(["#Deeplearning1", "#NLP2"]);
      expect(tagRows(slot)[0]!.querySelector(".tree-hash")?.textContent).toBe("#");
    });

    it("searches the tag on click, marks the row current and unmarks it when the search changes", () => {
      const { slot, sidebar, actions } = mount();
      sidebar.setLibrary(folders, tagged);
      tagRows(slot)[0]!.click();
      expect(actions.searchTag).toHaveBeenCalledWith("Deep learning");
      expect(tagRows(slot)[0]!.classList.contains("current")).toBe(true);
      sidebar.setQuery("");
      expect(tagRows(slot)[0]!.classList.contains("current")).toBe(false);
      sidebar.setQuery('tag:"deep learning"');
      expect(tagRows(slot)[0]!.getAttribute("aria-current")).toBe("true");
    });

    it("clears the tag search when the current tag is clicked again", () => {
      const { slot, sidebar, actions } = mount();
      sidebar.setLibrary(folders, tagged);
      tagRows(slot)[0]!.click();
      tagRows(slot)[0]!.click();
      expect(actions.searchTag).toHaveBeenLastCalledWith("");
      expect(tagRows(slot)[0]!.classList.contains("current")).toBe(false);
    });

    it("takes part in keyboard navigation: Enter on a focused tag row searches it", () => {
      const { slot, sidebar, actions } = mount();
      sidebar.setLibrary(folders, tagged);
      key(slot, "End");
      key(slot, "Enter");
      expect(actions.searchTag).toHaveBeenCalledWith("NLP");
    });
  });
});

describe("sidebar sections", () => {
  function mountSection(collapsed: string[] = []) {
    const actions = { openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() };
    const saveCollapsed = jest.fn();
    const slot = document.createElement("div");
    document.body.replaceChildren(slot);
    const sidebar = mountLibrarySidebar(slot, { actions, expanded: [], saveExpanded: jest.fn(), collapsed, saveCollapsed });
    sidebar.setLibrary([], []);
    return { sidebar, slot, saveCollapsed };
  }

  const libraryHead = (slot: HTMLElement): HTMLElement => slot.querySelector<HTMLElement>('[data-section="library"]')!;

  describe("LibrarySidebar.setSectionCollapsed", () => {
    it("collapses a section, updates aria-expanded and persists the collapsed ids", () => {
      const { sidebar, slot, saveCollapsed } = mountSection();
      sidebar.setSectionCollapsed("library", true);
      expect(libraryHead(slot).getAttribute("aria-expanded")).toBe("false");
      expect(saveCollapsed).toHaveBeenCalledWith(["library"]);
    });

    it("expands a collapsed section", () => {
      const { sidebar, slot, saveCollapsed } = mountSection(["library"]);
      sidebar.setSectionCollapsed("library", false);
      expect(libraryHead(slot).getAttribute("aria-expanded")).toBe("true");
      expect(saveCollapsed).toHaveBeenCalledWith([]);
    });

    it("does nothing when the section is already in the requested state", () => {
      const { sidebar, saveCollapsed } = mountSection(["library"]);
      sidebar.setSectionCollapsed("library", true);
      expect(saveCollapsed).not.toHaveBeenCalled();
    });
  });

  const groupFolders = [{ name: "A", path: "papers/A", children: [] }];
  const groupPapers = [{ record: { id: "t1", title: "one", status: "done" as const, tags: ["NLP"] }, folder: "papers/A" }];

  function mountSidebarGroups(expanded: string[] = [], collapsed: string[] = []) {
    const actions = { openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() };
    const saveExpanded = jest.fn();
    const saveCollapsed = jest.fn();
    const slot = document.createElement("div");
    document.body.replaceChildren(slot);
    const sidebar = mountLibrarySidebar(slot, { actions, expanded, saveExpanded, collapsed, saveCollapsed });
    sidebar.setLibrary(groupFolders, groupPapers);
    return { slot, saveCollapsed };
  }

  const group = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-group="${id}"]`)!;
  const hasFolder = (slot: HTMLElement): boolean => slot.querySelector('[data-path="papers/A"]') !== null;
  const hasTag = (slot: HTMLElement): boolean => slot.querySelector('[data-tag="NLP"]') !== null;
  const pressKey = (slot: HTMLElement, k: string): void => { slot.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };
  const focusGroup = (slot: HTMLElement, id: string): void => {
    slot.focus();
    const treeRows = [...slot.querySelectorAll<HTMLElement>(".tree-row, .tree-section, .tree-group")];
    const target = treeRows.findIndex((r) => r === group(slot, id));
    for (let i = 0; i <= target; i++) pressKey(slot, i === 0 ? "Home" : "ArrowDown");
  };

  describe("collapsible Folders and Tags headings", () => {
    // jsdom has no scrollIntoView, which the focused row calls.
    beforeAll(() => { Element.prototype.scrollIntoView = jest.fn(); });

    it("opens both groups by default, with a chevron and aria-expanded", () => {
      const { slot } = mountSidebarGroups();
      expect(group(slot, "library.folders").getAttribute("aria-expanded")).toBe("true");
      expect(group(slot, "library.tags").getAttribute("aria-expanded")).toBe("true");
      expect(group(slot, "library.folders").querySelector(".tree-section-chevron svg")).not.toBeNull();
      expect(hasFolder(slot) && hasTag(slot)).toBe(true);
    });

    it("renders Folders and Tags as panes nested in the Library body, each with its own body", () => {
      const { slot } = mountSidebarGroups();
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
      const { slot } = mountSidebarGroups([], ["library.tags"]);
      const tags = slot.querySelector('[data-pane="library.tags"]')!;
      expect(tags.classList.contains("open")).toBe(false);
      expect(tags.querySelector(".tree-pane-body")!.children).toHaveLength(0);
      const bare = document.createElement("div");
      const sidebar = mountLibrarySidebar(bare, { actions: {} as never, expanded: [], saveExpanded: jest.fn(), collapsed: [], saveCollapsed: jest.fn() });
      sidebar.setLibrary(groupFolders, [{ record: { id: "t2", title: "two", status: "done" as const, tags: [] }, folder: "papers/A" }]);
      expect(bare.querySelector('[data-pane="library.tags"]')).toBeNull();
      expect(bare.querySelector('[data-pane="library.folders"]')).not.toBeNull();
    });

    it("hides the folder rows when the Folders heading is clicked and saves the key", () => {
      const { slot, saveCollapsed } = mountSidebarGroups();
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
      const { slot, saveCollapsed } = mountSidebarGroups();
      group(slot, "library.tags").click();
      expect(hasTag(slot)).toBe(false);
      expect(hasFolder(slot)).toBe(true);
      expect(saveCollapsed).toHaveBeenLastCalledWith(["library.tags"]);
    });

    it("keeps the folder tree's own expansion while Folders is collapsed", () => {
      const { slot } = mountSidebarGroups(["papers/A"]);
      expect(slot.querySelector('[data-id="t1"]')).not.toBeNull();
      group(slot, "library.folders").click();
      group(slot, "library.folders").click();
      expect(slot.querySelector('[data-id="t1"]')).not.toBeNull();
    });

    it("toggles from the keyboard: Enter, ArrowLeft collapses, ArrowRight expands", () => {
      const { slot, saveCollapsed } = mountSidebarGroups();
      focusGroup(slot, "library.tags");
      pressKey(slot, "Enter");
      expect(hasTag(slot)).toBe(false);
      pressKey(slot, "ArrowRight");
      expect(hasTag(slot)).toBe(true);
      pressKey(slot, "ArrowLeft");
      expect(hasTag(slot)).toBe(false);
      expect(saveCollapsed).toHaveBeenLastCalledWith(["library.tags"]);
      pressKey(slot, " ");
      expect(hasTag(slot)).toBe(true);
    });

    it("restores the collapsed state on remount", () => {
      const { slot } = mountSidebarGroups([], ["library.folders", "library.tags"]);
      expect(hasFolder(slot) || hasTag(slot)).toBe(false);
      expect(group(slot, "library.folders").getAttribute("aria-expanded")).toBe("false");
      expect(group(slot, "library.tags").getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps the Folders hover actions working while collapsed", () => {
      const { slot } = mountSidebarGroups([], ["library.folders"]);
      expect(group(slot, "library.folders").querySelector('[data-tree="new"]')).not.toBeNull();
    });
  });
});
