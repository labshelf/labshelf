/**
 * @jest-environment jsdom
 */
// Tests the library sidebar through its mount handle: rows, counts, expansion, current folder, selection and keyboard.
import { mountLibrarySidebar, type SidebarPaper, type SidebarProjectActions } from "../../../../src/library-ui/dom";

const paper = (id: string, folder: string, title: string, status: "unread" | "reading" | "done"): SidebarPaper =>
  ({ record: { id, title, status }, folder });

const folders = [
  { name: "A", path: "papers/A", children: [{ name: "B", path: "papers/A/B", children: [] }] },
  { name: "Z", path: "papers/Z", children: [] },
];
const papers = [
  paper("r1", "papers", "zeta root", "done"),
  paper("a1", "papers/A", "beta", "unread"),
  paper("a2", "papers/A", "Alpha", "done"),
  paper("b1", "papers/A/B", "deep", "reading"),
  paper("b2", "papers/A/B", "deeper", "reading"),
];
const tagged = [
  { record: { id: "t1", title: "one", status: "done" as const, tags: ["NLP", "Deep learning"] }, folder: "papers" },
  { record: { id: "t2", title: "two", status: "unread" as const, tags: ["nlp"] }, folder: "papers" },
];

function mount(expanded: string[] = [], collapsed: string[] = [], withProjects = false, withAddFiles = false) {
  const actions = { ...(withAddFiles ? { addFiles: jest.fn() } : {}), openFolder: jest.fn(), revealPaper: jest.fn(), createFolder: jest.fn(), renameFolder: jest.fn(), removeFolder: jest.fn(), searchTag: jest.fn() };
  const saveExpanded = jest.fn();
  const saveCollapsed = jest.fn();
  const projects = { open: jest.fn(), menu: jest.fn(), browseTemplates: jest.fn(), allProjects: jest.fn(), newBlank: jest.fn(), addExisting: jest.fn() } as unknown as SidebarProjectActions & Record<string, jest.Mock>;
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const sidebar = mountLibrarySidebar(slot, { actions, expanded, saveExpanded, collapsed, saveCollapsed, ...(withProjects ? { projects } : {}) });
  sidebar.setLibrary(folders, papers);
  return { slot, sidebar, actions, saveExpanded, saveCollapsed, projects };
}

const project = (id: string, group = "", count?: string) =>
  ({ id, name: `P ${id}`, format: "latex" as const, tooltip: `tip ${id}`, ...(group ? { folder: group } : {}), ...(count ? { count } : {}) });
const section = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-section="${id}"]`)!;
const rows = (slot: HTMLElement): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".tree-row")];
const compact = (el: Element | null): string => (el?.textContent ?? "").replace(/\s+/g, "");
const allPapers = (slot: HTMLElement): HTMLElement => slot.querySelector<HTMLElement>("[data-all-papers]")!;
const folder = (slot: HTMLElement, path: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-path="${path}"]`)!;
const paperEl = (slot: HTMLElement, id: string): HTMLElement | null => slot.querySelector<HTMLElement>(`[data-id="${id}"]`);
const order = (slot: HTMLElement): string[] => rows(slot).slice(1).map((r) => r.dataset["path"] ?? r.dataset["id"] ?? "");
const twisty = (slot: HTMLElement, path: string): void => folder(slot, path).querySelector<HTMLElement>(".tree-twisty")!.click();
const key = (slot: HTMLElement, k: string): void => { slot.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); };

describe("mountLibrarySidebar", () => {
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

  describe("projects", () => {
    it("renders project rows with mark, name and count, and opens one on click", () => {
      const { slot, sidebar, projects } = mount([], [], true);
      sidebar.setProjects([project("/a", "", "3"), project("/b")]);
      const row = slot.querySelector<HTMLElement>('[data-project="/a"]')!;
      expect(row.querySelector(".tree-ref")?.textContent).toBe("TEX");
      expect(row.querySelector(".tree-label")?.textContent).toBe("P /a");
      expect(row.querySelector(".tree-count")?.textContent).toBe("3");
      expect(row.getAttribute("title")).toBe("tip /a");
      expect(slot.querySelector('[data-project="/b"] .tree-count')).toBeNull();
      row.click();
      expect(projects.open).toHaveBeenCalledWith("/a");
    });

    it("opens the focused project with Enter", () => {
      const { slot, sidebar, projects } = mount([], ["library"], true);
      sidebar.setProjects([project("/a")]);
      for (let i = 0; i < 5; i++) { key(slot, "ArrowDown"); }
      key(slot, "Enter");
      expect(projects.open).toHaveBeenCalledWith("/a");
    });

    it("asks the host for its menu on right-click, with the pointer position", () => {
      const { slot, sidebar, projects } = mount([], [], true);
      sidebar.setProjects([project("/a")]);
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 12, clientY: 34 });
      slot.querySelector('[data-project="/a"]')!.dispatchEvent(e);
      expect(e.defaultPrevented).toBe(true);
      expect(projects.menu).toHaveBeenCalledWith("/a", { x: 12, y: 34 });
    });

    it("nests projects under their folder row, folders first, and shows them only while the folder is expanded", () => {
      const list = [project("/a", "Thesis"), project("/b"), project("/c", "Thesis")];
      const closed = mount([], [], true);
      closed.sidebar.setProjects(list);
      expect([...closed.slot.querySelectorAll<HTMLElement>("[data-project-folder]")].map((r) => compact(r))).toEqual(["Thesis2"]);
      expect(rows(closed.slot).map((r) => r.dataset["project"]).filter(Boolean)).toEqual(["/b"]);
      const open = mount(["project-folder:Thesis"], [], true);
      open.sidebar.setProjects(list);
      expect(rows(open.slot).map((r) => r.dataset["project"]).filter(Boolean)).toEqual(["/a", "/c", "/b"]);
    });

    it("opens the All projects tab from its row under Explore templates, and keeps archived projects out of the tree", () => {
      const { slot, sidebar, projects } = mount([], [], true);
      sidebar.setProjects([project("/a"), { ...project("/b"), hidden: true }]);
      const keys = [...slot.querySelectorAll<HTMLElement>(".tree-row[data-key]")].map((r) => r.dataset["key"]);
      expect(keys.indexOf("allProjects")).toBe(keys.indexOf("templates") + 1);
      expect(slot.querySelector('[data-project="/b"]')).toBeNull();
      slot.querySelector<HTMLElement>("[data-all-projects]")!.click();
      expect(projects.allProjects).toHaveBeenCalledTimes(1);
    });

    it("leaves out the templates row and the buttons of actions the host cannot run", () => {
      const { slot, sidebar } = mount([], [], true);
      sidebar.setProjects([]);
      sidebar.setProjectOffers({ templates: false, addExisting: false });
      expect(slot.querySelector("[data-templates]")).toBeNull();
      expect(slot.querySelector('.tree-empty-actions [data-tree="browse"]')).toBeNull();
      expect(slot.querySelector('.tree-empty-actions [data-tree="add"]')).toBeNull();
      expect(slot.querySelector('.tree-empty-actions [data-tree="blank"]')).not.toBeNull();
    });

    it("leaves out creating projects, project folders and the All projects row for a host that has none of them", () => {
      const { slot, sidebar } = mount([], [], true);
      sidebar.setProjects([project("/a", "Thesis")]);
      sidebar.setProjectOffers({ templates: false, addExisting: false, newBlank: false, projectFolders: false, allProjects: false });
      expect(slot.querySelector("[data-all-projects]")).toBeNull();
      expect(slot.querySelector('[data-tree="blank"]')).toBeNull();
      expect(slot.querySelector('[data-tree="project-folder"]')).toBeNull();
      expect(slot.querySelector('[data-tree="project-refresh"]')).not.toBeNull();
      expect(slot.querySelector('[data-project-folder="Thesis"]')).not.toBeNull();
      for (const target of [slot.querySelector('[data-project-folder="Thesis"]')!, slot.querySelector('[data-group="projects.list"]')!]) {
        const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
        target.dispatchEvent(e);
        expect(e.defaultPrevented).toBe(false);
      }
      sidebar.setProjects([]);
      expect(slot.querySelector(".tree-empty")?.textContent).toBe("No projects yet.");
      expect(slot.querySelector(".tree-empty-actions")).toBeNull();
    });

    it("shows an empty state whose buttons call the host actions", () => {
      const { slot, sidebar, projects } = mount([], [], true);
      expect(slot.querySelector(".tree-empty-actions")).not.toBeNull();
      sidebar.setProjects([]);
      const click = (a: string): void => slot.querySelector<HTMLElement>(`.tree-empty-actions [data-tree="${a}"]`)!.click();
      click("browse"); click("blank"); click("add");
      expect(projects.browseTemplates).toHaveBeenCalledTimes(1);
      expect(projects.newBlank).toHaveBeenCalledTimes(1);
      expect(projects.addExisting).toHaveBeenCalledTimes(1);
      expect(slot.textContent).toContain("No projects yet.");
    });

    it("opens the template gallery from the Explore templates row and creates a blank project from the list header", () => {
      const { slot, sidebar, projects } = mount([], [], true);
      sidebar.setProjects([project("/a")]);
      slot.querySelector<HTMLElement>("[data-templates]")!.click();
      slot.querySelector<HTMLElement>('[data-tree="blank"]')!.click();
      expect(projects.browseTemplates).toHaveBeenCalledTimes(1);
      expect(projects.newBlank).toHaveBeenCalledTimes(1);
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
