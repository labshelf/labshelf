// Connects the browser sidebar to library and project actions.
import { icon, parentDir, type HostEndpoint } from "@labshelf/core";
import { el, mountLibrarySidebar, showMenu, type LibraryUi } from "@labshelf/core/dom";
import { bx } from "../../platform";
import type { PagePrefs } from "../prefs";
import type { TabKindName } from "../tabs";
import type { SidebarProjects } from "./sidebarProjects";

/** The page's sidebar Projects section and the Cloudflare relay its shares use; both exist only on a page that shows projects. */
export interface SidebarProjectParts {
  projects: SidebarProjects;
  manageRelay(): void;
}

/** The library's share-link actions that start from no folder. */
export interface SidebarShareLinks {
  manage(): void;
  importLink(): void;
}

function headButton(label: string, glyph: "gear" | "cloud" | "link", onClick: (button: HTMLElement) => void): HTMLElement {
  const button = el("button", { class: "ls-icon-btn", type: "button", title: label, "aria-label": label, "aria-haspopup": glyph === "link" ? "menu" : null, html: icon(glyph) });
  button.addEventListener("click", () => onClick(button));
  return button;
}

function shareLinksButton(shareLinks: SidebarShareLinks): HTMLElement {
  return headButton("Share links", "link", (button) => showMenu(button, [
    { label: "Import Share Link…", icon: "download", onSelect: shareLinks.importLink },
    { label: "Manage Shared Links", icon: "link", onSelect: shareLinks.manage },
  ]));
}

/**
 * Fills the sidebar slot with the brand and the tree; returns the tree's unsubscribe function.
 * Without `project` the tree has no Projects section; with `showLibrary` false it has no Library section.
 */
export function mountSidebarTree(
  ui: Pick<LibraryUi, "store" | "folders" | "dropTarget">, slot: HTMLElement, prefs: PagePrefs, host: Pick<HostEndpoint, "post">,
  project: SidebarProjectParts | null, openTab: (kind: TabKindName) => void, showLibrary: boolean, shareLinks: SidebarShareLinks,
): () => void {
  slot.innerHTML = `<div class="tree-head"><span class="ls-brand">LabShelf</span></div>`;
  const head = slot.querySelector(".tree-head")!;
  if (showLibrary) head.append(shareLinksButton({ manage: shareLinks.manage, importLink: () => { openTab("library"); shareLinks.importLink(); } }));
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
      shareFolder: (path) => folders.share(path),
      searchTag: (tag) => { openTab("library"); store.searchTag(tag); },
    },
    expanded: prefs.treeExpanded(),
    saveExpanded: (paths) => prefs.saveTreeExpanded(paths),
    collapsed: prefs.collapsedSections(),
    saveCollapsed: (ids) => prefs.saveCollapsedSections(ids),
    ...(projects ? { projects: projects.actions } : {}),
    dropTarget: (row, path) => ui.dropTarget(row, path),
  });
  projects?.attach(sidebar);
  if (!showLibrary) return () => undefined;
  // Browser record paths are IndexedDB keys relative to the library root, so the parent is the tree folder.
  const offLibrary = store.select((s) => ({ folders: s.folders, papers: s.papers }), ({ folders: tree, papers }) =>
    sidebar.setLibrary(tree, papers.map((record) => ({ record, folder: parentDir(record.path, "/") }))));
  const offView = store.select((s) => s.folder, (folder) => sidebar.setCurrent(folder));
  const offSelection = store.select((s) => (s.selected.size === 1 ? [...s.selected][0]! : null), (id) => sidebar.setSelected(id));
  const offQuery = store.select((s) => s.query, (query) => sidebar.setQuery(query));
  return () => { offLibrary(); offView(); offSelection(); offQuery(); };
}
