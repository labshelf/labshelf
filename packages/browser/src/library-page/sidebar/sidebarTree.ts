// Draws the sidebar folder tree like VS Code's tree view, with recursive paper counts and drop targets.
// Expansion is saved; the open folder's ancestors stay expanded.
import { PAPERS_DIR, ROOT_LABEL, countPapersUnder, escapeHtml, icon, isUnderDir, parentDir, type FolderTreeNode } from "@labshelf/core";
import { el, showMenu, type LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import { citationMapEntry } from "./citationMapEntry";

interface Tree {
  ui: LibraryUi;
  prefs: PagePrefs;
  el: HTMLElement;
  expanded: Set<string>;
  focused: string | null;
}

const HEAD_HTML = `
  <div class="tree-head"><span class="ls-brand">${icon("logo")}<span>LabShelf</span></span></div>
  <div class="tree-section" role="button" aria-expanded="true">
    <div class="tree-section-left"><span class="twisty">${icon("chevron-down")}</span><span>Library</span></div>
    <div class="tree-actions">
      <button class="ls-icon-btn" data-tree="new" title="New folder at library root">${icon("folder-plus")}</button>
      <button class="ls-icon-btn" data-tree="collapse" title="Collapse all">${icon("layers")}</button>
    </div>
  </div>
  <div class="tree" role="tree" tabindex="0" aria-label="Library folders"></div>`;

function row(t: Tree, node: FolderTreeNode, depth: number, count: number, isRoot: boolean): HTMLElement {
  const selected = t.ui.store.get().folder;
  const hasChildren = node.children.length > 0;
  const open = t.expanded.has(node.path);
  const guides = Array.from({ length: depth }, (_, i) => `<span class="guide" style="left:${16 + i * 8}px"></span>`).join("");
  const r = el("div", {
    class: `tree-row${node.path === selected ? " selected" : ""}${hasChildren && !open ? " collapsed" : ""}`,
    role: "treeitem",
    "aria-selected": String(node.path === selected),
    "aria-expanded": hasChildren ? String(open) : undefined,
    "data-path": node.path,
    "data-root": isRoot ? "1" : undefined,
    style: `--depth:${depth}`,
    title: isRoot ? "Every paper in the library" : node.path.slice(PAPERS_DIR.length + 1),
    html: `${guides}<span class="tree-twisty${hasChildren ? "" : " leaf"}">${icon("chevron-down")}</span>` +
      `<span class="tree-icon">${icon(isRoot ? "library" : "folder")}</span>` +
      `<span class="tree-label">${escapeHtml(node.name)}</span>` +
      (count > 0 ? `<span class="tree-count">${count}</span>` : "") +
      `<span class="tree-row-actions"><button class="ls-icon-btn" data-action="new" title="New subfolder" tabindex="-1">${icon("folder-plus")}</button></span>`,
  });
  r.draggable = false;
  t.ui.dropTarget(r, node.path);
  return r;
}

function paintFocus(t: Tree): void {
  const active = document.activeElement === t.el;
  t.el.querySelectorAll<HTMLElement>(".tree-row").forEach((r) => r.classList.toggle("focused", active && r.dataset["path"] === t.focused));
  if (active) t.el.querySelector(".tree-row.focused")?.scrollIntoView({ block: "nearest" });
}

function render(t: Tree): void {
  const { folders, papers } = t.ui.store.get();
  const paths = papers.map((p) => p.path);
  const frag = document.createDocumentFragment();
  frag.append(row(t, { name: ROOT_LABEL, path: PAPERS_DIR, children: [] }, 0, countPapersUnder(paths, PAPERS_DIR, "/"), true));
  const walk = (nodes: FolderTreeNode[], depth: number): void => {
    for (const node of nodes) {
      frag.append(row(t, node, depth, countPapersUnder(paths, node.path, "/"), false));
      if (node.children.length && t.expanded.has(node.path)) walk(node.children, depth + 1);
    }
  };
  walk(folders, 0);
  if (folders.length === 0) {
    frag.append(el("div", { class: "tree-empty", text: "No folders yet. Folders you create here also appear in the VS Code extension after the next sync." }));
  }
  t.el.replaceChildren(frag);
  paintFocus(t);
}

function setExpanded(t: Tree, path: string, open: boolean): void {
  if (open) t.expanded.add(path); else t.expanded.delete(path);
  t.prefs.saveTreeExpanded([...t.expanded]);
  render(t);
}

function rowAt(e: Event): HTMLElement | null {
  return (e.target as HTMLElement).closest<HTMLElement>(".tree-row");
}

function onClick(e: MouseEvent, t: Tree): void {
  const r = rowAt(e);
  if (!r) return;
  const path = r.dataset["path"] ?? PAPERS_DIR;
  const target = e.target as HTMLElement;
  t.focused = path;
  if (target.closest("[data-action='new']")) { t.ui.folders.create(path); return; }
  if (target.closest(".tree-twisty") && r.getAttribute("aria-expanded") !== null) { setExpanded(t, path, !t.expanded.has(path)); return; }
  t.ui.store.openFolder(path);
  // Clicking a collapsed parent opens it and expands it, as VS Code does.
  if (r.getAttribute("aria-expanded") === "false") setExpanded(t, path, true);
}

function onContextMenu(e: MouseEvent, t: Tree): void {
  const r = rowAt(e);
  if (!r) return;
  e.preventDefault();
  const path = r.dataset["path"] ?? PAPERS_DIR;
  const isRoot = !!r.dataset["root"];
  t.focused = path;
  paintFocus(t);
  showMenu({ x: e.clientX, y: e.clientY }, [
    { label: "Open", icon: "list", onSelect: () => t.ui.store.openFolder(path) },
    { label: "New Subfolder…", icon: "folder-plus", onSelect: () => t.ui.folders.create(path) },
    "separator",
    { label: "Rename…", icon: "edit", disabled: isRoot, hint: "F2", onSelect: () => t.ui.folders.rename(path) },
    { label: "Delete Folder…", icon: "trash", disabled: isRoot, danger: true, onSelect: () => t.ui.folders.remove(path) },
  ]);
}

function onKey(e: KeyboardEvent, t: Tree): void {
  const rows = Array.from(t.el.querySelectorAll<HTMLElement>(".tree-row"));
  const paths = rows.map((r) => r.dataset["path"] ?? PAPERS_DIR);
  let idx = t.focused ? paths.indexOf(t.focused) : -1;
  if (idx === -1) idx = Math.max(0, paths.indexOf(t.ui.store.get().folder));
  const current = rows[idx];
  const path = paths[idx] ?? PAPERS_DIR;
  const expandable = current?.getAttribute("aria-expanded") !== null;
  const open = current?.getAttribute("aria-expanded") === "true";
  const parent = parentDir(path, "/");
  if (e.key === "ArrowDown") t.focused = paths[Math.min(paths.length - 1, idx + 1)] ?? path;
  else if (e.key === "ArrowUp") t.focused = paths[Math.max(0, idx - 1)] ?? path;
  else if (e.key === "Home") t.focused = paths[0] ?? PAPERS_DIR;
  else if (e.key === "End") t.focused = paths[paths.length - 1] ?? PAPERS_DIR;
  else if (e.key === "ArrowRight") { if (expandable && !open) setExpanded(t, path, true); else if (open) t.focused = paths[idx + 1] ?? path; }
  else if (e.key === "ArrowLeft") { if (open) setExpanded(t, path, false); else if (path !== PAPERS_DIR) t.focused = parent; }
  else if (e.key === "Enter" || e.key === " ") t.ui.store.openFolder(path);
  else if (e.key === "F2" && path !== PAPERS_DIR) t.ui.folders.rename(path);
  else if ((e.key === "Delete" || e.key === "Backspace") && path !== PAPERS_DIR) t.ui.folders.remove(path);
  else return;
  e.preventDefault();
  paintFocus(t);
}

/** Fills the sidebar slot with the citation map entry and the tree; returns the tree's unsubscribe function. */
export function mountSidebarTree(ui: LibraryUi, slot: HTMLElement, prefs: PagePrefs, openCitationMap: () => void): () => void {
  slot.innerHTML = HEAD_HTML;
  slot.querySelector(".tree-head")!.after(citationMapEntry(openCitationMap));
  const section = slot.querySelector<HTMLElement>(".tree-section")!;
  const t: Tree = { ui, prefs, el: slot.querySelector<HTMLElement>(".tree")!, expanded: new Set(prefs.treeExpanded()), focused: null };
  section.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest<HTMLElement>("[data-tree]")?.dataset["tree"];
    if (action === "new") { ui.folders.create(PAPERS_DIR); return; }
    if (action === "collapse") { t.expanded.clear(); prefs.saveTreeExpanded([]); render(t); return; }
    const collapsed = section.classList.toggle("collapsed");
    section.setAttribute("aria-expanded", String(!collapsed));
  });
  t.el.addEventListener("click", (e) => onClick(e, t));
  t.el.addEventListener("dblclick", (e) => { const r = rowAt(e); if (r && !r.dataset["root"]) ui.folders.rename(r.dataset["path"]!); });
  t.el.addEventListener("contextmenu", (e) => onContextMenu(e, t));
  t.el.addEventListener("keydown", (e) => onKey(e, t));
  t.el.addEventListener("focus", () => { if (!t.focused) t.focused = ui.store.get().folder; paintFocus(t); });
  t.el.addEventListener("blur", () => { t.focused = null; paintFocus(t); });
  return ui.store.select((s) => ({ folders: s.folders, folder: s.folder, papers: s.papers }), ({ folder }) => {
    // Reveal the open folder: expand its ancestors, as VS Code's tree.reveal does.
    for (let p = parentDir(folder, "/"); p !== PAPERS_DIR && isUnderDir(p, PAPERS_DIR, "/"); p = parentDir(p, "/")) t.expanded.add(p);
    render(t);
  });
}
