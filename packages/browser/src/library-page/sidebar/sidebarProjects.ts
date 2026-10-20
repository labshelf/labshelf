// Answers the core sidebar's Projects section: lists the projects, opens one in the page's project session, opens the template and All projects tabs, and shows the menus that share and join projects.
import type { ProjectTreeView } from "@labshelf/core";
import { showMenu, type LibrarySidebar, type MenuEntry, type ProjectOffers, type SidebarProjectActions } from "@labshelf/core/dom";
import type { TabKindName } from "../tabs";
import type { BrowserProjectRow, ProjectsSource } from "../projects";
import type { ProjectSession } from "../session";

// Templates and All projects open workspace tabs; the sidebar creates no project and keeps no project folders.
const BROWSER_OFFERS: Partial<ProjectOffers> = { addExisting: false, newBlank: false, projectFolders: false };

const ignore = (): void => undefined;

const TREE_VIEWS: readonly string[] = ["files", "outline", "checklist"];
const isTreeView = (view: string): view is ProjectTreeView => TREE_VIEWS.includes(view);

export type SidebarSession = Pick<ProjectSession, "current" | "openProject" | "closeProject" | "attachSidebar" | "treeClick" | "treeAction">;

/** The sharing a project's menus offer. */
export interface SidebarSharing {
  /** Asks for an invite link and joins its shared project. */
  join(): void;
  /** The sharing entries of the menu of the project in `folder`. */
  menu(folder: string): MenuEntry[];
}

export interface SidebarProjects {
  actions: SidebarProjectActions;
  /** Hands the sidebar to the session, hides the offers the browser cannot run yet and lists the projects; they are listed again whenever the page comes back into view. */
  attach(sidebar: LibrarySidebar): void;
}

function menuEntries(source: ProjectsSource, sharing: SidebarSharing, row: BrowserProjectRow): MenuEntry[] {
  const { projectId, pdf } = row;
  if (projectId === undefined) return [];
  const open: MenuEntry[] = pdf ? [{ label: "Open PDF", icon: "file-text", onSelect: () => source.openPdf(projectId, pdf) }] : [];
  const shared = sharing.menu(row.id);
  return open.length > 0 && shared.length > 0 ? [...open, "separator", ...shared] : [...open, ...shared];
}

export function createSidebarProjects(source: ProjectsSource, openTab: (kind: TabKindName) => void, session: SidebarSession, sharing: SidebarSharing): SidebarProjects {
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
    treeClick: (view, key) => { if (isTreeView(view)) session.treeClick(view, key); },
    treeAction: (action) => { void session.treeAction(action); },
    openProjectMenu: (anchor) => {
      const open = session.current();
      const entries = open?.kind === "ready" ? sharing.menu(open.folder) : [];
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
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
      load();
    },
  };
}
