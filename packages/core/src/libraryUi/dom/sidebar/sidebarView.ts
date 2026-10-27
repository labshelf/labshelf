// Draws the Library section of the sidebar: the folder and tag tree with its counts, and the rows it is made of.
import { PAPERS_DIR, isUnderDir, deriveParentDir, ROOT_LABEL } from "../../../library/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { renderIcon, escapeHtml } from "../../../ui/index.js";
import type { LibraryTree, SidebarProject } from "../../folderModel.js";
import type { TagCount } from "../../listModel.js";
import { createTagQuery } from "../../store/index.js";
import {
  createProjectListActions, renderProjectTreeNodes, type ProjectOffers, type SidebarProjectActions, addOpenProject,
} from "./sidebarProjects.js";
import { renderGroupRow, renderSectionRow, type GroupId, type SectionId } from "./librarySidebar.js";
import { renderSpaceRows, type SidebarSpacesState } from "./sidebarSpaces.js";
import type { ShareHost } from "../../../share/index.js";
import type { SidebarOpenProject } from "../../folderModel.js";

/** Every focusable row: section headers, group headings and tree rows. */
export const NAV_ROWS = ".tree-row, .tree-section, .tree-group";

/** What a click, a key or the context menu asks the host to do. Folder paths are tree paths (`papers/A/B`). */
export interface SidebarActions {
  openFolder(path: string): void;
  revealPaper(id: string): void;
  createFolder(parent: string): void;
  /** Imports files into a folder; absent when the host adds papers some other way. */
  addFiles?(parent: string): void;
  /** Re-reads the library from disk; absent when the host keeps it live on its own. */
  refresh?(): void;
  renameFolder(path: string): void;
  removeFolder(path: string): void;
  /** Narrows the list to the papers with this tag. */
  searchTag(tag: string): void;
}

export interface SidebarState extends SidebarSpacesState {
  el: HTMLElement;
  actions: SidebarActions;
  expanded: Set<string>;
  saveExpanded(paths: string[]): void;
  collapsed: Set<string>;
  saveCollapsed(ids: string[]): void;
  /** Absent when the host has no Projects section. */
  projects: SidebarProjectActions | undefined;
  projectList: readonly SidebarProject[];
  offers: ProjectOffers;
  /** The project open in the window; its trees lead the Projects section. */
  openProject: SidebarOpenProject | null;
  /** Fold state of the open project's tree nodes the user toggled, keyed `<view>:<key>`. */
  treeOpen: Map<string, boolean>;
  /** The open inline add input of a project tree, with its text so far, kept across renders. */
  treeInput: { view: string; key: string; placeholder: string; text: string } | null;
  sharing?: ShareHost | undefined;
  /** Lets the host accept drops on a folder row; called on every render. */
  dropTarget?: ((row: HTMLElement, path: string) => void) | undefined;
  /** The focused row's key (see `readRowKey`). */
  focused: string | null;
  selectedId: string | null;
  current: string;
  /** Where Folders' New folder and Add files put things: the folder last clicked, or a clicked paper's folder. */
  target: string;
  tree: LibraryTree | null;
  /** Every tag in the library with its paper count; the Tags group shows only when there are some. */
  tags: readonly TagCount[];
  /** The list's search text; the tag row whose search it is, is current. */
  query: string;
}

// The Explorer's own title actions, in its order: new file, new folder, refresh, collapse all.
const folderActions = (a: SidebarActions): string =>
  (a.addFiles ? `<button class="ls-icon-btn" data-tree="add-files" title="Add files to the selected folder">${renderIcon("new-file")}</button>` : "") +
  `<button class="ls-icon-btn" data-tree="new" title="New folder in the selected folder">${renderIcon("new-folder")}</button>` +
  (a.refresh ? `<button class="ls-icon-btn" data-tree="refresh" title="Refresh">${renderIcon("reload")}</button>` : "") +
  `<button class="ls-icon-btn" data-tree="collapse" title="Collapse all">${renderIcon("collapse-all")}</button>`;

let nextTreeId = 0;
const treeIds = new WeakMap<HTMLElement, number>();

export function drawFocus(t: SidebarState): void {
  const active = document.activeElement === t.el;
  if (!treeIds.has(t.el)) treeIds.set(t.el, ++nextTreeId);
  t.el.querySelectorAll<HTMLElement>(NAV_ROWS).forEach(r => {
    r.id = `ls-tree-${treeIds.get(t.el)}-${encodeURIComponent(readRowKey(r))}`;
    r.classList.toggle("focused", active && readRowKey(r) === t.focused);
  });
  const focused = t.el.querySelector<HTMLElement>(".focused");
  if (focused) { t.el.setAttribute("aria-activedescendant", focused.id); focused.scrollIntoView({ block: "nearest" }); }
  else t.el.removeAttribute("aria-activedescendant");
}

function appendFolders(t: SidebarState, tree: LibraryTree, frag: HTMLElement): void {
  const walk = (path: string, depth: number): void => {
    for (const child of tree.children(path)) {
      if (child.kind === "paper") { frag.append(renderPaperRow(child.id, child.title, depth, child.id === t.selectedId)); continue; }
      const open = t.expanded.has(child.path);
      const current = child.path === t.current;
      // An empty folder still shows its twisty, as folders do in VS Code's Explorer.
      const r = renderFolderRow(child.name, child.path, { depth, count: child.count, open, current });
      t.dropTarget?.(r, child.path);
      frag.append(r);
      if (open) walk(child.path, depth + 1);
    }
  };
  walk(PAPERS_DIR, GROUP_ROW_DEPTH);
}

/**
 * A pane: its header, then a body that scrolls on its own. Open panes share the height, as VS Code's view panes do.
 * A group's pane nests in the Library body, which stacks its panes instead of scrolling.
 */
function appendPane(parent: Element | DocumentFragment, id: SectionId | GroupId, header: HTMLElement, open: boolean): HTMLElement {
  const body = renderElement("div", { class: "tree-pane-body" });
  const pane = renderElement("div", { class: `tree-pane${open ? " open" : ""}`, "data-pane": id });
  pane.append(header, body);
  parent.append(pane);
  return body;
}

function appendTags(t: SidebarState, library: HTMLElement): void {
  const query = t.query.trim().toLowerCase();
  const open = !t.collapsed.has("library.tags");
  const body = appendPane(library, "library.tags", renderGroupRow("library.tags", "Tags", open), open);
  if (open) for (const { tag, count } of t.tags) body.append(renderTagRow(tag, count, createTagQuery(tag) === query));
}

function appendLibrary(t: SidebarState, tree: LibraryTree, frag: DocumentFragment): void {
  const open = !t.collapsed.has("library");
  const body = appendPane(frag, "library", renderSectionRow("library", "Library", open), open);
  if (!open) return;
  body.classList.add("tree-pane-stack");
  body.append(renderAllPapersRow(tree.total(), t.current === PAPERS_DIR));
  const foldersOpen = !t.collapsed.has("library.folders");
  const folders = appendPane(body, "library.folders", renderGroupRow("library.folders", "Folders", foldersOpen, folderActions(t.actions)), foldersOpen);
  if (foldersOpen) {
    appendFolders(t, tree, folders);
    if (tree.children(PAPERS_DIR).length === 0) folders.append(renderElement("div", { class: "tree-empty", text: "No folders yet." }));
  }
  if (t.tags.length > 0) appendTags(t, body);
}

const canJoin = (t: SidebarState): boolean => t.sharing?.offers().projects === true;

function appendProjects(t: SidebarState, frag: DocumentFragment): void {
  const open = !t.collapsed.has("projects");
  const body = appendPane(frag, "projects", renderSectionRow("projects", "Projects", open), open);
  if (!open) return;
  body.classList.add("tree-pane-stack");
  // An open project owns the section; the project list and the gallery return when it closes.
  if (t.openProject) { addOpenProject(t, body, appendPane, () => render(t)); return; }
  if (t.offers.templates) body.append(renderExploreTemplatesRow());
  if (t.offers.allProjects) body.append(renderAllProjectsRow());
  const listOpen = !t.collapsed.has("projects.list");
  const list = appendPane(body, "projects.list", renderGroupRow("projects.list", "My projects", listOpen, createProjectListActions(t.offers, canJoin(t))), listOpen);
  if (listOpen) list.append(...renderProjectTreeNodes(t.projectList, t.expanded, t.offers, canJoin(t)));
}

export function render(t: SidebarState): void {
  // Every render rebuilds the panes, so each body's scroll position is carried over by section id.
  const scrolled = new Map([...t.el.querySelectorAll<HTMLElement>(".tree-pane")].map((p) => [p.dataset["pane"], p.lastElementChild?.scrollTop ?? 0]));
  const frag = document.createDocumentFragment();
  if (t.tree) appendLibrary(t, t.tree, frag);
  if (t.projects) appendProjects(t, frag);
  if (t.spaces) appendSpaces(t, frag);
  t.el.replaceChildren(frag);
  t.el.querySelectorAll<HTMLElement>(".tree-pane").forEach((p) => { p.lastElementChild!.scrollTop = scrolled.get(p.dataset["pane"]) ?? 0; });
  drawFocus(t);
}

/** Folds or unfolds a section or a group heading; the folders' own expansion is kept. */
export function updateSectionOpen(t: SidebarState, id: SectionId | GroupId): void {
  if (t.collapsed.has(id)) t.collapsed.delete(id); else t.collapsed.add(id);
  t.saveCollapsed([...t.collapsed]);
  render(t);
}

export function setExpanded(t: SidebarState, path: string, open: boolean): void {
  if (open) t.expanded.add(path); else t.expanded.delete(path);
  t.saveExpanded([...t.expanded]);
  render(t);
}

/** Expands a folder and its ancestors without saving them, as VS Code's tree.reveal does. */
export function openFolderPath(t: SidebarState, path: string): void {
  for (let p = path; p !== PAPERS_DIR && isUnderDir(p, PAPERS_DIR, "/"); p = deriveParentDir(p, "/")) t.expanded.add(p);
}

function appendSpaces(t: SidebarState, frag: DocumentFragment): void {
  const open = !t.collapsed.has("spaces");
  const action = `<button class="ls-icon-btn" data-tree="space-new" title="New Space" aria-label="New Space">${renderIcon("plus")}</button>`;
  const body = appendPane(frag, "spaces", renderSectionRow("spaces", "Spaces", open, action), open);
  body.setAttribute("role", "group");
  if (open) body.append(...renderSpaceRows(t));
}

/** Row identity shared by focus, keyboard and click handling: `section:<id>`, `group:<id>`, `all-papers`, `folder:<path>`, `paper:<id>`, `tag:<tag>` or `project:<id>`. */
export const readRowKey = (r: HTMLElement): string => r.dataset["key"] ?? "";

/** The depth of the rows directly under a Library group heading (Folders, Tags): one indent step past its chevron, as in VS Code's trees. */
export const GROUP_ROW_DEPTH = 1;

const countHtml = (count: number): string => (count > 0 ? `<span class="tree-count">${count}</span>` : "");

export function renderTreeItem(key: string, depth: number, current: boolean, attrs: Record<string, string | undefined>, html: string): HTMLElement {
  return renderElement("div", {
    class: `tree-row${current ? " current" : ""}${attrs["aria-expanded"] === "false" ? " collapsed" : ""}`,
    role: "treeitem",
    "data-key": key,
    style: `--depth:${depth}`,
    ...attrs,
    html,
  });
}

/** The row that opens the library root; `current` when the list shows it. */
function renderAllPapersRow(count: number, current: boolean): HTMLElement {
  return renderTreeItem("all-papers", 0, current, { "data-all-papers": "", "aria-current": current ? "true" : undefined, "aria-selected": "false" },
    `<span class="tree-icon">${renderIcon("book-open")}</span><span class="tree-label">${escapeHtml(ROOT_LABEL)}</span>${countHtml(count)}`);
}

/** The fixed row that opens the template gallery, as All papers opens the library root. */
function renderExploreTemplatesRow(): HTMLElement {
  return renderTreeItem("templates", 0, false, { "data-templates": "", "aria-selected": "false" },
    `<span class="tree-icon">${renderIcon("layers")}</span><span class="tree-label">Explore templates</span>`);
}

/** The fixed row that opens the All projects tab, where archived and trashed projects live. */
function renderAllProjectsRow(): HTMLElement {
  return renderTreeItem("allProjects", 0, false, { "data-all-projects": "", "aria-selected": "false" },
    `<span class="tree-icon">${renderIcon("list")}</span><span class="tree-label">All projects</span>`);
}

export interface FolderRowState { depth: number; count: number; open: boolean; current: boolean }

function renderFolderRow(name: string, path: string, s: FolderRowState): HTMLElement {
  return renderTreeItem(`folder:${path}`, s.depth, s.current, {
    "data-path": path,
    "aria-current": s.current ? "true" : undefined,
    "aria-selected": "false",
    "aria-expanded": String(s.open),
    title: path.slice(PAPERS_DIR.length + 1),
  }, `<span class="tree-twisty">${renderIcon("chevron-down")}</span>` +
    `<span class="tree-label">${escapeHtml(name)}</span>` +
    countHtml(s.count));
}

/** A paper; its title ellipsizes, so the full title sits in the tooltip. */
function renderPaperRow(id: string, title: string, depth: number, selected: boolean): HTMLElement {
  return renderTreeItem(`paper:${id}`, depth, false, { "data-id": id, "aria-selected": String(selected), title },
    `<span class="tree-twisty leaf">${renderIcon("chevron-down")}</span><span class="tree-ref">REF</span><span class="tree-label">${escapeHtml(title)}</span>`);
}

/** A tag over the whole library; `current` when the list's search is exactly that tag. */
function renderTagRow(tag: string, count: number, current: boolean): HTMLElement {
  return renderTreeItem(`tag:${tag}`, GROUP_ROW_DEPTH, current, { "data-tag": tag, "aria-current": current ? "true" : undefined, "aria-selected": "false", title: `Show papers tagged ${tag}` },
    `<span class="tree-twisty leaf">${renderIcon("chevron-down")}</span><span class="tree-label"><span class="tree-hash" aria-hidden="true">#</span>${escapeHtml(tag)}</span>${countHtml(count)}`);
}

export const formatLabel = (format: SidebarProject["format"]): string =>
  format ? `<span class="tree-ref ${format === "latex" ? "tex" : "typ"}">${format === "latex" ? "TEX" : "TYP"}</span>` : `<span class="tree-ref"></span>`;

/** A folder of My projects; it exists only while a project sits under it. */
export function renderProjectFolderRow(name: string, path: string, s: FolderRowState): HTMLElement {
  return renderTreeItem(`project-folder:${path}`, s.depth, false, { "data-project-folder": path, "aria-selected": "false", "aria-expanded": String(s.open), title: path },
    `<span class="tree-twisty">${renderIcon("chevron-down")}</span><span class="tree-label">${escapeHtml(name)}</span>` + countHtml(s.count));
}

/** A writing project: its format label (TEX or TYP, like a paper's REF), name and optional count. */
export function renderProjectRow(p: SidebarProject, depth: number): HTMLElement {
  return renderTreeItem(`project:${p.id}`, depth, false, { "data-project": p.id, "aria-selected": "false", title: p.tooltip },
    `<span class="tree-twisty leaf">${renderIcon("chevron-down")}</span>${formatLabel(p.format)}<span class="tree-label">${escapeHtml(p.name)}</span>` +
    (p.count ? `<span class="tree-count">${escapeHtml(p.count)}</span>` : ""));
}
