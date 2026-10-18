// Mounts the sidebar: the brand and the core library sidebar, whose Library follows the page's store and whose Projects open
// in the editor page. Clicking a paper asks the host to reveal it.
import { icon, parentDir, type HostEndpoint } from "@labshelf/core";
import { mountLibrarySidebar, type LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import type { ProjectsSource } from "../projects";
import { createSidebarProjects } from "./sidebarProjects";

/** Fills the sidebar slot with the brand and the tree; returns the tree's unsubscribe function. */
export function mountSidebarTree(ui: LibraryUi, slot: HTMLElement, prefs: PagePrefs, host: Pick<HostEndpoint, "post">, projectsSource: ProjectsSource): () => void {
  slot.innerHTML = `<div class="tree-head"><span class="ls-brand">${icon("logo")}<span>LabShelf</span></span></div>`;
  const projects = createSidebarProjects(projectsSource);
  const treeEl = slot.appendChild(document.createElement("div"));
  const { store, folders } = ui;
  const sidebar = mountLibrarySidebar(treeEl, {
    actions: {
      openFolder: (path) => store.openFolder(path),
      revealPaper: (id) => host.post({ type: "reveal", id }),
      createFolder: (parent) => folders.create(parent),
      renameFolder: (path) => folders.rename(path),
      removeFolder: (path) => folders.remove(path),
      searchTag: (tag) => store.searchTag(tag),
    },
    expanded: prefs.treeExpanded(),
    saveExpanded: (paths) => prefs.saveTreeExpanded(paths),
    collapsed: prefs.collapsedSections(),
    saveCollapsed: (ids) => prefs.saveCollapsedSections(ids),
    projects: projects.actions,
    dropTarget: (row, path) => ui.dropTarget(row, path),
  });
  projects.attach(sidebar);
  // Browser record paths are IndexedDB keys relative to the library root, so the parent is the tree folder.
  const offLibrary = store.select((s) => ({ folders: s.folders, papers: s.papers }), ({ folders: tree, papers }) =>
    sidebar.setLibrary(tree, papers.map((record) => ({ record, folder: parentDir(record.path, "/") }))));
  const offView = store.select((s) => s.folder, (folder) => sidebar.setCurrent(folder));
  const offSelection = store.select((s) => (s.selected.size === 1 ? [...s.selected][0]! : null), (id) => sidebar.setSelected(id));
  const offQuery = store.select((s) => s.query, (query) => sidebar.setQuery(query));
  return () => { offLibrary(); offView(); offSelection(); offQuery(); };
}
