// Renders the sidebar from a library tree, with its expansion, focus, current folder, and selected paper.
import { PAPERS_DIR, isUnderDir, parentDir } from "../../../library/index.js";
import { el } from "../../../ui/dom/index.js";
import { icon } from "../../../ui/index.js";
import type { LibraryTree, TagCount } from "../../derive/index.js";
import { tagQuery } from "../../searchQueries.js";
import { PROJECT_LIST_ACTIONS, projectTreeNodes, type SidebarProject, type SidebarProjectActions } from "./sidebarProjects.js";
import { GROUP_ROW_DEPTH, allProjectsRow, exploreTemplatesRow, folderRow, paperRow, rowKey, allPapersRow, tagRow } from "./sidebarRows.js";
import { groupRow, sectionRow, type GroupId, type SectionId } from "./sidebarSections.js";
import { appendOpenProject } from "./sidebarOpenProject.js";
import type { SidebarOpenProject } from "../../sidebarTrees.js";

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

export interface SidebarState {
  el: HTMLElement;
  actions: SidebarActions;
  expanded: Set<string>;
  saveExpanded(paths: string[]): void;
  collapsed: Set<string>;
  saveCollapsed(ids: string[]): void;
  /** Absent when the host has no Projects section. */
  projects: SidebarProjectActions | undefined;
  projectList: readonly SidebarProject[];
  /** The project open in the window; its trees lead the Projects section. */
  openProject: SidebarOpenProject | null;
  /** Fold state of the open project's tree nodes the user toggled, keyed `<view>:<key>`. */
  treeOpen: Map<string, boolean>;
  /** The open inline add input of a project tree, with its text so far, kept across renders. */
  treeInput: { view: string; key: string; placeholder: string; text: string } | null;
  /** Lets the host accept drops on a folder row; called on every render. */
  dropTarget?: ((row: HTMLElement, path: string) => void) | undefined;
  /** The focused row's key (see `rowKey`). */
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
  (a.addFiles ? `<button class="ls-icon-btn" data-tree="add-files" title="Add files to the selected folder">${icon("new-file")}</button>` : "") +
  `<button class="ls-icon-btn" data-tree="new" title="New folder in the selected folder">${icon("new-folder")}</button>` +
  (a.refresh ? `<button class="ls-icon-btn" data-tree="refresh" title="Refresh">${icon("reload")}</button>` : "") +
  `<button class="ls-icon-btn" data-tree="collapse" title="Collapse all">${icon("collapse-all")}</button>`;

export function paintFocus(t: SidebarState): void {
  const active = document.activeElement === t.el;
  t.el.querySelectorAll<HTMLElement>(NAV_ROWS).forEach((r) => r.classList.toggle("focused", active && rowKey(r) === t.focused));
  if (active) t.el.querySelector(".focused")?.scrollIntoView({ block: "nearest" });
}

function appendFolders(t: SidebarState, tree: LibraryTree, frag: HTMLElement): void {
  const walk = (path: string, depth: number): void => {
    for (const child of tree.children(path)) {
      if (child.kind === "paper") { frag.append(paperRow(child.id, child.title, depth, child.id === t.selectedId)); continue; }
      const open = t.expanded.has(child.path);
      const current = child.path === t.current;
      // An empty folder still shows its twisty, as folders do in VS Code's Explorer.
      const r = folderRow(child.name, child.path, { depth, count: child.count, open, current });
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
  const body = el("div", { class: "tree-pane-body" });
  const pane = el("div", { class: `tree-pane${open ? " open" : ""}`, "data-pane": id });
  pane.append(header, body);
  parent.append(pane);
  return body;
}

function appendTags(t: SidebarState, library: HTMLElement): void {
  const query = t.query.trim().toLowerCase();
  const open = !t.collapsed.has("library.tags");
  const body = appendPane(library, "library.tags", groupRow("library.tags", "Tags", open), open);
  if (open) for (const { tag, count } of t.tags) body.append(tagRow(tag, count, tagQuery(tag) === query));
}

function appendLibrary(t: SidebarState, tree: LibraryTree, frag: DocumentFragment): void {
  const open = !t.collapsed.has("library");
  const body = appendPane(frag, "library", sectionRow("library", "Library", open), open);
  if (!open) return;
  body.classList.add("tree-pane-stack");
  body.append(allPapersRow(tree.total(), t.current === PAPERS_DIR));
  const foldersOpen = !t.collapsed.has("library.folders");
  const folders = appendPane(body, "library.folders", groupRow("library.folders", "Folders", foldersOpen, folderActions(t.actions)), foldersOpen);
  if (foldersOpen) {
    appendFolders(t, tree, folders);
    if (tree.children(PAPERS_DIR).length === 0) folders.append(el("div", { class: "tree-empty", text: "No folders yet." }));
  }
  if (t.tags.length > 0) appendTags(t, body);
}

function appendProjects(t: SidebarState, frag: DocumentFragment): void {
  const open = !t.collapsed.has("projects");
  const body = appendPane(frag, "projects", sectionRow("projects", "Projects", open), open);
  if (!open) return;
  body.classList.add("tree-pane-stack");
  // An open project owns the section; the project list and the gallery return when it closes.
  if (t.openProject) { appendOpenProject(t, body, appendPane, () => render(t)); return; }
  body.append(exploreTemplatesRow(), allProjectsRow());
  const listOpen = !t.collapsed.has("projects.list");
  const list = appendPane(body, "projects.list", groupRow("projects.list", "My projects", listOpen, PROJECT_LIST_ACTIONS), listOpen);
  if (listOpen) list.append(...projectTreeNodes(t.projectList, t.expanded));
}

export function render(t: SidebarState): void {
  // Every render rebuilds the panes, so each body's scroll position is carried over by section id.
  const scrolled = new Map([...t.el.querySelectorAll<HTMLElement>(".tree-pane")].map((p) => [p.dataset["pane"], p.lastElementChild?.scrollTop ?? 0]));
  const frag = document.createDocumentFragment();
  if (t.tree) appendLibrary(t, t.tree, frag);
  if (t.projects) appendProjects(t, frag);
  t.el.replaceChildren(frag);
  t.el.querySelectorAll<HTMLElement>(".tree-pane").forEach((p) => { p.lastElementChild!.scrollTop = scrolled.get(p.dataset["pane"]) ?? 0; });
  paintFocus(t);
}

/** Folds or unfolds a section or a group heading; the folders' own expansion is kept. */
export function toggleSection(t: SidebarState, id: SectionId | GroupId): void {
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
export function expandTo(t: SidebarState, path: string): void {
  for (let p = path; p !== PAPERS_DIR && isUnderDir(p, PAPERS_DIR, "/"); p = parentDir(p, "/")) t.expanded.add(p);
}
