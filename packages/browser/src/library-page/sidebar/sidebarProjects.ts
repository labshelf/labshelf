// Answers the core sidebar's Projects section: lists the projects, opens one in the editor page and shows its menu.
import { showMenu, type LibrarySidebar, type MenuEntry, type ProjectOffers, type SidebarProjectActions } from "@labshelf/core/dom";
import type { BrowserProjectRow, ProjectsSource } from "../projects";

// The browser has no template gallery, All projects page, project creation or project folders.
const BROWSER_OFFERS: ProjectOffers = { templates: false, addExisting: false, newBlank: false, projectFolders: false, allProjects: false };

const ignore = (): void => undefined;

export interface SidebarProjects {
  actions: SidebarProjectActions;
  /** Hides the offers the browser cannot run and lists the projects; they are listed again whenever the page comes back into view. */
  attach(sidebar: LibrarySidebar): void;
}

function menuEntries(source: ProjectsSource, row: BrowserProjectRow): MenuEntry[] {
  const { projectId, pdf } = row;
  if (projectId === undefined) return [];
  return [
    { label: "Open in Editor", icon: "edit", onSelect: () => source.openEditor(projectId) },
    ...(pdf ? [{ label: "Open PDF", icon: "file-text" as const, onSelect: () => source.openPdf(projectId, pdf) }] : []),
  ];
}

export function createSidebarProjects(source: ProjectsSource): SidebarProjects {
  let rows: BrowserProjectRow[] = [];
  let sidebar: LibrarySidebar | undefined;
  const row = (id: string): BrowserProjectRow | undefined => rows.find((r) => r.id === id);
  // rows() logs its own failure; the list keeps what it showed.
  const load = (): void => { void source.rows().then((next) => { rows = next; sidebar?.setProjects(next); }, ignore); };
  const actions: SidebarProjectActions = {
    open: (id) => { const projectId = row(id)?.projectId; if (projectId !== undefined) source.openEditor(projectId); },
    menu: (id, at) => { const found = row(id); const entries = found ? menuEntries(source, found) : []; if (entries.length > 0) showMenu(at, entries); },
    refresh: load,
    // The offers hide these, and no project is ever open in the sidebar: the editor page opens it.
    browseTemplates: ignore, allProjects: ignore, newBlank: ignore, addExisting: ignore, newFolder: ignore, renameFolder: ignore, deleteFolder: ignore,
    closeProject: ignore, openProjectMenu: ignore, treeAction: ignore, treeClick: ignore, treeToggle: ignore, treeCheck: ignore, treeMenu: ignore, treeAdd: ignore,
  };
  return {
    actions,
    attach(target) {
      sidebar = target;
      target.setProjectOffers(BROWSER_OFFERS);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") load(); });
      load();
    },
  };
}
