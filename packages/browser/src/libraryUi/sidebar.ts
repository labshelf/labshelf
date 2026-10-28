// Connects the browser sidebar to library, project and Space actions: the tree mount, the Projects section and the Spaces section.
import { deriveParentDir, deriveSidebarRows, formatError, isProjectTreeView, renderIcon, type HostEndpoint, type ILogger, type ShareHost, type SpaceStore } from "@labshelf/core";
import {
  askInputBox, createProjectShareMenuEntries, mountLibrarySidebar, renderElement, showMenu, showToast,
  type LibrarySidebar, type LibraryUi, type MenuEntry, type ProjectOffers, type SidebarProjectActions, type SidebarSpaceActions,
} from "@labshelf/core/dom";
import { bx } from "../platform";
import type { BrowserProjectRow, ProjectSession, ProjectsSource } from "../writing";
import type { TabKindName } from "./editorArea";
import type { PagePrefs } from "./prefs";
import type { PageSpaces } from "./spaces";

// ---- Projects section
// Templates and All projects open workspace tabs; the sidebar creates no project and keeps no project folders.
const BROWSER_OFFERS: Partial<ProjectOffers> = { addExisting: false, newBlank: false, projectFolders: false };

const ignore = (): void => undefined;

export type SidebarSession = Pick<ProjectSession, "current" | "openProject" | "closeProject" | "attachSidebar" | "treeClick" | "treeAction">;

export interface SidebarProjects {
  actions: SidebarProjectActions;
  /** Hands the sidebar to the session, hides the offers the browser cannot run yet and lists the projects; they are listed again whenever the project list changes. */
  attach(sidebar: LibrarySidebar): void;
}

function menuEntries(source: ProjectsSource, sharing: ShareHost, row: BrowserProjectRow): MenuEntry[] {
  const { projectId, pdf } = row;
  if (projectId === undefined) return [];
  const open: MenuEntry[] = pdf ? [{ label: "Open PDF", icon: "file-text", onSelect: () => source.openPdf(projectId, pdf) }] : [];
  const shared = createProjectShareMenuEntries(sharing, { id: row.id, shared: row.shared === true });
  return open.length > 0 && shared.length > 0 ? [...open, "separator", ...shared] : [...open, ...shared];
}

export function createSidebarProjects(
  source: ProjectsSource, openTab: (kind: TabKindName) => void, session: SidebarSession, sharing: ShareHost,
  onProjectsChange: (listener: () => void) => void,
): SidebarProjects {
  let rows: BrowserProjectRow[] = [];
  let sidebar: LibrarySidebar | undefined;
  const row = (id: string): BrowserProjectRow | undefined => rows.find((r) => r.id === id);
  // rows() logs its own failure; the list keeps what it showed.
  const load = (): void => { void source.rows().then((next) => { rows = next; sidebar?.setProjects(next); }, ignore); };
  const actions: SidebarProjectActions = {
    open: (id) => {
      const projectId = row(id)?.projectId;
      if (projectId !== undefined) void source.entryOf(projectId).then((entry) => (entry ? session.openProject(entry) : undefined));
    },
    menu: (id, at) => { const found = row(id); const entries = found ? menuEntries(source, sharing, found) : []; if (entries.length > 0) showMenu(at, entries); },
    refresh: load,
    browseTemplates: () => openTab("templates"),
    allProjects: () => openTab("all-projects"),
    closeProject: () => { void session.closeProject(); },
    treeClick: (view, key) => { if (isProjectTreeView(view)) session.treeClick(view, key); },
    treeAction: (action) => { void session.treeAction(action); },
    openProjectMenu: (anchor) => {
      const open = session.current();
      // The session keeps the settings it opened with; the project list is what a share, join or leave refreshes.
      const entries = open?.kind === "ready" ? createProjectShareMenuEntries(sharing, { id: open.folder, shared: row(open.folder)?.shared === true }) : [];
      if (entries.length > 0) showMenu(anchor, entries);
    },
    // The offers hide the first five; check boxes and inline add are not offered here.
    newBlank: ignore, addExisting: ignore, newFolder: ignore, renameFolder: ignore, deleteFolder: ignore,
    treeToggle: ignore, treeCheck: ignore, treeMenu: ignore, treeAdd: ignore,
  };
  return {
    actions,
    attach(target) {
      sidebar = target;
      session.attachSidebar({
        setOpenProject: (project) => target.setOpenProject(project ?? null),
        collapseLibrary: () => target.setSectionCollapsed("library", true),
      });
      target.setProjectOffers(BROWSER_OFFERS);
      // The page's sharing re-reads the project list after a share, join or leave and when the page comes back into view.
      onProjectsChange(load);
      load();
    },
  };
}

// ---- Spaces section
export interface SidebarSpaces {
  actions: SidebarSpaceActions;
  attach(sidebar: LibrarySidebar): () => void;
}

async function dropPapers(store: SpaceStore, id: string, folder: string | undefined, ids: string[]): Promise<void> {
  const result = await store.read(id);
  if (result.state !== "ready") throw new Error(`Cannot add papers to unreadable Space: ${id}`);
  const present = new Set(result.space.papers.map((paper) => paper.id));
  await store.addPapers(id, ids.filter((paper) => !present.has(paper)), folder);
  for (const paper of ids.filter((paper) => present.has(paper))) await store.moveReference(id, paper, folder);
}

export function createSidebarSpaces({ store, port }: PageSpaces, log: ILogger): SidebarSpaces {
  const run = (work: () => Promise<unknown>): void => {
    void work().catch((error: unknown) => {
      void log.error("spaces-sidebar", error);
      showToast(formatError(error), "error");
    });
  };
  const name = (title: string, value = "") => askInputBox({ title, value, validate: (text) => text.trim() ? null : "Enter a name" });
  const rename = async (id: string): Promise<void> => {
    const result = await store.read(id);
    if (result.state !== "ready") throw new Error(`Cannot rename unreadable Space: ${id}`);
    const next = await name("Rename Space", result.space.name);
    if (next !== undefined) await store.renameSpace(id, next);
  };
  const renameFolder = async (id: string, folder: string): Promise<void> => {
    const result = await store.read(id);
    if (result.state !== "ready") throw new Error(`Cannot rename folder in unreadable Space: ${id}`);
    const next = await name("Rename folder", result.space.folders.find((item) => item.id === folder)?.name);
    if (next !== undefined) await store.renameFolder(id, folder, next);
  };
  return {
    actions: {
      openCatalog: () => run(() => port.openCatalog()),
      openSpace: (id, folder) => run(() => port.openSpace(id, folder === undefined ? "overview" : "papers")),
      openPaper: (id) => run(() => port.openPaper(id)),
      newSpace: () => run(async () => { const next = await name("New Space"); if (next !== undefined) await port.openSpace(await store.createSpace(next)); }),
      renameSpace: (id) => run(() => rename(id)),
      deleteSpace: (id) => run(() => store.deleteSpace(id)),
      newFolder: (id, parent) => run(async () => { const next = await name("New folder"); if (next !== undefined) await store.createFolder(id, next, parent); }),
      renameFolder: (id, folder) => run(() => renameFolder(id, folder)),
      deleteFolder: (id, folder) => run(() => store.deleteFolder(id, folder)),
      dropPapers: (id, folder, ids) => run(() => dropPapers(store, id, folder, ids)),
      removeReference: (id, paper) => run(() => store.removePaper(id, paper)),
    },
    attach(sidebar) {
      const update = (): void => sidebar.setSpaces(deriveSidebarRows(store.list(), port.library()));
      const offStore = store.onChange(update);
      const offLibrary = port.onLibraryChange(update);
      update();
      return () => { offStore(); offLibrary(); };
    },
  };
}

// ---- Tree
/** The page's sidebar Projects section and the Cloudflare relay its shares use; both exist only on a page that shows projects. */
export interface SidebarProjectParts {
  projects: SidebarProjects;
  manageRelay(): void;
}

function headButton(label: string, glyph: "gear" | "cloud", onClick: () => void): HTMLElement {
  const button = renderElement("button", { class: "ls-icon-btn", type: "button", title: label, "aria-label": label, html: renderIcon(glyph) });
  button.addEventListener("click", onClick);
  return button;
}

/**
 * Fills the sidebar slot with the brand and the tree; returns the tree's unsubscribe function.
 * Without `project` the tree has no Projects section; with `showLibrary` false it has no Library section.
 */
export function mountSidebarTree(
  ui: Pick<LibraryUi, "store" | "folders" | "dropTarget">, slot: HTMLElement, prefs: PagePrefs, host: Pick<HostEndpoint, "post">,
  project: SidebarProjectParts | null, openTab: (kind: TabKindName) => void, showLibrary: boolean, sharing: ShareHost, spaces?: SidebarSpaces,
): () => void {
  slot.innerHTML = `<div class="tree-head"><span class="ls-brand">LabShelf</span></div>`;
  const head = slot.querySelector(".tree-head")!;
  if (project) head.append(headButton("Cloudflare relay for shared projects", "cloud", project.manageRelay));
  head.append(headButton("LabShelf settings", "gear", () => { void bx.runtime.openOptionsPage(); }));
  const projects = project?.projects;
  const treeEl = slot.appendChild(document.createElement("div"));
  const { store, folders } = ui;
  const sidebar = mountLibrarySidebar(treeEl, {
    actions: {
      openFolder: (path) => { openTab("library"); store.openFolder(path); },
      revealPaper: (id) => { openTab("library"); host.post({ type: "reveal", id }); },
      createFolder: (parent) => folders.create(parent),
      renameFolder: (path) => folders.rename(path),
      removeFolder: (path) => folders.remove(path),
      searchTag: (tag) => { openTab("library"); store.searchTag(tag); },
    },
    sharing,
    expanded: prefs.treeExpanded(),
    saveExpanded: (paths) => prefs.saveTreeExpanded(paths),
    collapsed: prefs.collapsedSections(),
    saveCollapsed: (ids) => prefs.saveCollapsedSections(ids),
    ...(projects ? { projects: projects.actions } : {}),
    ...(showLibrary && spaces ? { spaces: spaces.actions } : {}),
    dropTarget: (row, path) => ui.dropTarget(row, path),
  });
  projects?.attach(sidebar);
  const offSpaces = showLibrary ? spaces?.attach(sidebar) : undefined;
  if (!showLibrary) return () => undefined;
  // Browser record paths are IndexedDB keys relative to the library root, so the parent is the tree folder.
  const offLibrary = store.select((s) => ({ folders: s.folders, papers: s.papers }), ({ folders: tree, papers }) =>
    sidebar.setLibrary(tree, papers.map((record) => ({ record, folder: deriveParentDir(record.path, "/") }))));
  const offView = store.select((s) => s.folder, (folder) => sidebar.setCurrent(folder));
  const offSelection = store.select((s) => (s.selected.size === 1 ? [...s.selected][0]! : null), (id) => sidebar.setSelected(id));
  const offQuery = store.select((s) => s.query, (query) => sidebar.setQuery(query));
  return () => { offSpaces?.(); offLibrary(); offView(); offSelection(); offQuery(); };
}
