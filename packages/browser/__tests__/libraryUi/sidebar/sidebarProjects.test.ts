/**
 * @jest-environment jsdom
 * @jest-environment-options {"customExportConditions": ["node", "node-addons"]}
 */
// The browser sidebar lists the library's projects under Projects and offers only what the browser can do.
import { createSharingHost, LibraryViewStore, type ProjectEntry } from "@labshelf/core";
import type { LibrarySidebar, LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../../../src/libraryUi/prefs";
import type { BrowserProjectRow, ProjectsSource } from "../../../src/writing/projectList";
import { createSidebarProjects, type SidebarSession } from "../../../src/libraryUi/sidebar/sidebarProjects";
import { mountSidebarTree } from "../../../src/libraryUi/sidebar/sidebarTree";

const ready: BrowserProjectRow = { id: "projects/thesis", name: "Thesis", format: "latex", tooltip: "thesis", kind: "ready", external: false, projectId: "thesis", pdf: "main.pdf" };
const broken: BrowserProjectRow = { id: "projects/gone", name: "gone", count: "missing", tooltip: "gone", kind: "broken", external: false };

const thesisEntry = { kind: "ready", folder: "projects/thesis", settings: { id: "thesis" } } as unknown as ProjectEntry;

async function mount(rows: BrowserProjectRow[] = [ready, broken]) {
  const store = new LibraryViewStore({ folders: [], papers: [], loading: false });
  const prefs = { treeExpanded: () => [], saveTreeExpanded: jest.fn(), collapsedSections: () => [], saveCollapsedSections: jest.fn() } as unknown as PagePrefs;
  const ui = { sidebar: null, store, folders: { create: jest.fn(), rename: jest.fn(), remove: jest.fn(), share: jest.fn() }, dropTarget: jest.fn(), dispose: jest.fn() } as unknown as LibraryUi;
  const source = {
    rows: jest.fn(async () => rows), openPdf: jest.fn(),
    entryOf: jest.fn(async (id: string) => (id === "thesis" ? thesisEntry : undefined)),
  } satisfies ProjectsSource;
  const session = { current: () => undefined, openProject: jest.fn(async () => true), closeProject: jest.fn(async () => true), attachSidebar: jest.fn(), treeClick: jest.fn(), treeAction: jest.fn(async () => undefined) } satisfies SidebarSession;
  const sharing = createSharingHost({ place: "this browser", logger: { log: async () => undefined, error: async () => undefined }, clipboard: { write: async () => undefined }, openLink: async () => undefined });
  const slot = document.createElement("div");
  document.body.replaceChildren(slot);
  const openTab = jest.fn();
  let projectsChanged = (): void => undefined;
  const onProjectsChange = (listener: () => void): void => { projectsChanged = listener; };
  mountSidebarTree(ui, slot, prefs, { post: jest.fn() }, { projects: createSidebarProjects(source, openTab, session, sharing, onProjectsChange), manageRelay: jest.fn() }, openTab, true, sharing);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { slot, source, openTab, session, projectsChanged: () => projectsChanged() };
}

const projectRow = (slot: HTMLElement, id: string): HTMLElement => slot.querySelector<HTMLElement>(`[data-project="${id}"]`)!;
const menuLabels = (): string[] => [...document.querySelectorAll(".ls-menu .ls-menu-label")].map((label) => label.textContent ?? "");

describe("sidebar projects glue", () => {
  it("shows the brand, Library and Projects, without a citation map entry", async () => {
    const { slot } = await mount();
    expect(slot.querySelector(".ls-brand")?.textContent).toBe("LabShelf");
    expect(slot.querySelector('[data-section="library"]')).not.toBeNull();
    expect(slot.querySelector('[data-section="projects"]')).not.toBeNull();
    expect(slot.textContent).not.toContain("Citation map");
  });

  it("lists the projects, offers Templates and All projects as tabs and hides what is not wired yet", async () => {
    const { slot, openTab } = await mount();
    expect(projectRow(slot, "projects/thesis").textContent).toContain("Thesis");
    slot.querySelector<HTMLElement>("[data-templates]")!.click();
    slot.querySelector<HTMLElement>("[data-all-projects]")!.click();
    expect(openTab.mock.calls).toEqual([["templates"], ["all-projects"]]);
    expect(slot.querySelector('[data-tree="blank"]')).toBeNull();
    expect(slot.querySelector('[data-tree="add"]')).toBeNull();
    expect(slot.querySelector('[data-tree="project-folder"]')).toBeNull();
  });

  it("opens a ready project in the session with the entry that matches its project id", async () => {
    const { slot, source, session } = await mount();
    projectRow(slot, "projects/thesis").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.openProject).toHaveBeenCalledWith(thesisEntry);
    projectRow(slot, "projects/gone").click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.entryOf).toHaveBeenCalledTimes(1);
    expect(session.openProject).toHaveBeenCalledTimes(1);
  });

  it("gives the session the sidebar so it can show the open project", async () => {
    const { session } = await mount();
    expect(session.attachSidebar).toHaveBeenCalledTimes(1);
  });

  it("offers Open PDF on a built project's menu", async () => {
    const { slot, source } = await mount();
    projectRow(slot, "projects/thesis").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    expect(menuLabels()).toEqual(["Open PDF"]);
    document.querySelectorAll<HTMLElement>(".ls-menu [role=menuitem]")[0]!.click();
    expect(source.openPdf).toHaveBeenCalledWith("thesis", "main.pdf");
  });

  it("lists the projects again on Refresh", async () => {
    const { slot, source } = await mount();
    slot.querySelector<HTMLElement>('[data-tree="project-refresh"]')!.click();
    expect(source.rows).toHaveBeenCalledTimes(2);
  });

  it("lists the projects again when a share, join or leave changes them", async () => {
    const { slot, source, projectsChanged } = await mount();
    source.rows.mockResolvedValueOnce([{ ...ready, name: "Thesis (shared)", shared: true }, broken]);
    projectsChanged();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(source.rows).toHaveBeenCalledTimes(2);
    expect(projectRow(slot, "projects/thesis").textContent).toContain("Thesis (shared)");
  });

  it("offers the open project the share entries of the latest project list, which a share or leave refreshes", async () => {
    // The session keeps the settings it opened with, so after a leave they still name the share.
    const session = { current: () => ({ ...thesisEntry, settings: { id: "thesis", shared: "share-1" } }) as unknown as ProjectEntry, openProject: jest.fn(async () => true), closeProject: jest.fn(async () => true), attachSidebar: jest.fn(), treeClick: jest.fn(), treeAction: jest.fn(async () => undefined) } satisfies SidebarSession;
    const host = createSharingHost({ place: "this browser", logger: { log: async () => undefined, error: async () => undefined }, clipboard: { write: async () => undefined }, openLink: async () => undefined });
    const sharing = { ...host, offers: () => ({ projects: true, links: false }) };
    const source = { rows: jest.fn(async () => [ready]), openPdf: jest.fn(), entryOf: jest.fn(async () => undefined) } satisfies ProjectsSource;
    const sidebar = { setProjects: jest.fn(), setOpenProject: jest.fn(), setSectionCollapsed: jest.fn(), setProjectOffers: jest.fn() } as unknown as LibrarySidebar;
    const projects = createSidebarProjects(source, jest.fn(), session, sharing, () => undefined);
    projects.attach(sidebar);
    await new Promise((resolve) => setTimeout(resolve, 0));
    projects.actions.openProjectMenu({ x: 0, y: 0 } as never);
    expect(menuLabels()).toEqual(["Share Project…"]);
  });
});
