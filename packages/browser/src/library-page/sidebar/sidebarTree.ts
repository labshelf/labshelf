// Mounts the sidebar: the citation map entry and the library tree of status scopes, folders and papers.
// Clicking a paper asks the host to reveal it; the tree follows the open folder and the selected paper.
import { PAPERS_DIR, icon, parentDir, type HostEndpoint, type StatusFilter } from "@labshelf/core";
import { showMenu, type LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import { citationMapEntry } from "./citationMapEntry";
import { onTreeKey } from "./treeKeys";
import { rowKey } from "./treeRows";
import { expandTo, markSelected, paintFocus, render, setExpanded, type Tree } from "./treeView";

const HEAD_HTML = `
  <div class="tree-head"><span class="ls-brand">${icon("logo")}<span>LabShelf</span></span></div>
  <div class="tree-section" role="button" aria-expanded="true">
    <div class="tree-section-left"><span class="twisty">${icon("chevron-down")}</span><span>Library</span></div>
    <div class="tree-actions">
      <button class="ls-icon-btn" data-tree="new" title="New folder at library root">${icon("folder-plus")}</button>
      <button class="ls-icon-btn" data-tree="collapse" title="Collapse all">${icon("layers")}</button>
    </div>
  </div>
  <div class="tree" role="tree" tabindex="0" aria-label="Library"></div>`;

const rowAt = (e: Event): HTMLElement | null => (e.target as HTMLElement).closest<HTMLElement>(".tree-row");

/** Opens a scope or folder in the list, or reveals a paper through the host. */
function activate(t: Tree, host: Pick<HostEndpoint, "post">, r: HTMLElement): void {
  const { scope, path, id } = r.dataset;
  if (id) host.post({ type: "reveal", id });
  else if (path) t.ui.store.openFolder(path);
  else if (scope) { t.ui.store.openFolder(PAPERS_DIR); t.ui.store.set({ status: scope as StatusFilter }); }
}

function onClick(e: MouseEvent, t: Tree, host: Pick<HostEndpoint, "post">): void {
  const r = rowAt(e);
  if (!r) return;
  const path = r.dataset["path"];
  const target = e.target as HTMLElement;
  t.focused = rowKey(r);
  if (path && target.closest("[data-action='new']")) { t.ui.folders.create(path); return; }
  if (path && target.closest(".tree-twisty") && r.getAttribute("aria-expanded") !== null) { setExpanded(t, path, !t.expanded.has(path)); return; }
  activate(t, host, r);
  // Clicking a collapsed parent opens it and expands it, as VS Code does.
  if (path && r.getAttribute("aria-expanded") === "false") setExpanded(t, path, true);
}

function onContextMenu(e: MouseEvent, t: Tree): void {
  const r = rowAt(e);
  const path = r?.dataset["path"];
  if (!r || !path) return;
  e.preventDefault();
  t.focused = rowKey(r);
  paintFocus(t);
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Open", icon: "list", onSelect: () => t.ui.store.openFolder(path) },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => t.ui.folders.create(path) },
    "separator",
    { label: "Rename…", icon: "edit", hint: "F2", onSelect: () => t.ui.folders.rename(path) },
    { label: "Delete Folder…", icon: "trash", danger: true, onSelect: () => t.ui.folders.remove(path) },
  ]);
}

function attachSection(section: HTMLElement, t: Tree): void {
  section.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-tree]")?.dataset["tree"];
    if (action === "new") { t.ui.folders.create(PAPERS_DIR); return; }
    if (action === "collapse") { t.expanded.clear(); t.prefs.saveTreeExpanded([]); render(t); return; }
    const collapsed = section.classList.toggle("collapsed");
    section.setAttribute("aria-expanded", String(!collapsed));
  });
}

/** Fills the sidebar slot with the citation map entry and the tree; returns the tree's unsubscribe function. */
export function mountSidebarTree(ui: LibraryUi, slot: HTMLElement, prefs: PagePrefs, openCitationMap: () => void, host: Pick<HostEndpoint, "post">): () => void {
  slot.innerHTML = HEAD_HTML;
  slot.querySelector(".tree-head")!.after(citationMapEntry(openCitationMap));
  const t: Tree = { ui, prefs, el: slot.querySelector<HTMLElement>(".tree")!, expanded: new Set(prefs.treeExpanded()), focused: null, selectedId: null, derived: null };
  attachSection(slot.querySelector<HTMLElement>(".tree-section")!, t);
  t.el.addEventListener("click", (e) => onClick(e, t, host));
  t.el.addEventListener("dblclick", (e) => { const path = rowAt(e)?.dataset["path"]; if (path) ui.folders.rename(path); });
  t.el.addEventListener("contextmenu", (e) => onContextMenu(e, t));
  t.el.addEventListener("keydown", (e) => onTreeKey(e, t, (r) => activate(t, host, r)));
  t.el.addEventListener("focus", () => { if (!t.focused) t.focused = t.el.querySelector<HTMLElement>(".tree-row.selected")?.dataset["key"] ?? null; paintFocus(t); });
  t.el.addEventListener("blur", () => { t.focused = null; paintFocus(t); });
  const offView = ui.store.select((s) => ({ folders: s.folders, folder: s.folder, papers: s.papers, status: s.status }), ({ folder }) => {
    expandTo(t, parentDir(folder, "/"));
    render(t);
  });
  const offSelection = ui.store.select((s) => (s.selected.size === 1 ? [...s.selected][0]! : null), (id) => markSelected(t, id));
  return () => { offView(); offSelection(); };
}
