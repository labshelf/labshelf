/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The browser sidebar glue maps core sidebar actions to the page store and the host.
import { LibraryViewStore, PAPERS_DIR, type PaperRecord } from "@labshelf/core";
import type { LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../../../src/library-page/prefs";
import { createSidebarProjects } from "../../../src/library-page/sidebar/sidebarProjects";
import { mountSidebarTree } from "../../../src/library-page/sidebar/sidebarTree";

const paper = (id: string, dir: string, title: string, status: PaperRecord["status"]): PaperRecord =>
  ({ id, title, path: `${dir}/${id}`, citeKey: `key-${id}`, status });

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

interface Setup { store: LibraryViewStore; slot: HTMLElement; posted: unknown[]; prefs: PagePrefs; saved: string[][]; openTab: jest.Mock }

function mount(expanded: string[] = [], sections = { library: true, projects: true }): Setup {
  const store = new LibraryViewStore({ folders, papers, loading: false });
  const saved: string[][] = [];
  const prefs = { treeExpanded: () => expanded, saveTreeExpanded: (p: string[]) => { saved.push(p); }, collapsedSections: () => [], saveCollapsedSections: jest.fn() } as unknown as PagePrefs;
  const posted: unknown[] = [];
  const host = { post: (message: unknown) => { posted.push(message); } };
  const ui = { sidebar: null, store, folders: { create: jest.fn(), rename: jest.fn(), remove: jest.fn(), share: jest.fn() }, dropTarget: jest.fn(), dispose: jest.fn() } as unknown as LibraryUi;
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const openTab = jest.fn();
  const projects = sections.projects ? createSidebarProjects(
    { rows: async () => [], entryOf: async () => undefined, openPdf: jest.fn() }, openTab,
    { current: () => undefined, openProject: jest.fn(), closeProject: jest.fn(), attachSidebar: jest.fn(), treeClick: jest.fn(), treeAction: jest.fn() },
    { join: jest.fn(), menu: () => [] },
  ) : null;
  mountSidebarTree(ui, slot, prefs, host, projects && { projects, manageRelay: jest.fn() }, openTab, sections.library, { manage: jest.fn(), importLink: jest.fn() });
  return { store, slot, posted, prefs, saved, openTab };
}

const rows = (slot: HTMLElement): HTMLElement[] => [...slot.querySelectorAll<HTMLElement>(".tree-row")];
const rowWithText = (slot: HTMLElement, text: string): HTMLElement => {
  const found = rows(slot).find((r) => (r.querySelector(".tree-label")?.textContent ?? r.textContent ?? "").trim().startsWith(text));
  if (!found) throw new Error(`no row "${text}"`);
  return found;
};
const paperRow = (slot: HTMLElement, id: string): HTMLElement | null => slot.querySelector<HTMLElement>(`[data-id="${id}"]`);

describe("sidebar tree glue", () => {
  it("opens the library root and shows the Library tab when All papers is clicked", () => {
    const { slot, store, openTab } = mount();
    store.openFolder("papers/Z");
    rowWithText(slot, "All papers").click();
    expect(store.get().folder).toBe(PAPERS_DIR);
    expect(openTab).toHaveBeenCalledWith("library");
  });

  it("posts a reveal message and shows the Library tab when a paper row is clicked", () => {
    const { slot, posted, openTab } = mount();
    paperRow(slot, "r1")!.click();
    expect(posted).toEqual([{ type: "reveal", id: "r1" }]);
    expect(openTab).toHaveBeenCalledWith("library");
  });

  it("marks the paper the store selects", () => {
    const { slot, store } = mount();
    store.selectOnly("r1");
    expect(paperRow(slot, "r1")!.getAttribute("aria-selected")).toBe("true");
  });

  it("has a Library and a Projects section by default", () => {
    const { slot } = mount();
    expect(slot.querySelector('[data-pane="library"]')).not.toBeNull();
    expect(slot.querySelector('[data-pane="projects"]')).not.toBeNull();
  });

  it("leaves out the Projects section when it is hidden", () => {
    const { slot } = mount([], { library: true, projects: false });
    expect(slot.querySelector('[data-pane="library"]')).not.toBeNull();
    expect(slot.querySelector('[data-pane="projects"]')).toBeNull();
  });

  it("leaves out the Library section when it is hidden", () => {
    const { slot } = mount([], { library: false, projects: true });
    expect(slot.querySelector('[data-pane="library"]')).toBeNull();
    expect(slot.querySelector('[data-pane="projects"]')).not.toBeNull();
    expect(paperRow(slot, "r1")).toBeNull();
  });
});
