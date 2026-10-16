// Renders the sidebar tree from the core library tree derivation, with saved expansion, focus and the selected paper.
import { PAPERS_DIR, isUnderDir, libraryTree, parentDir, type LibraryTree, type PaperRecord, type FolderTreeNode } from "@labshelf/core";
import { el, type LibraryUi } from "@labshelf/core/dom";
import type { PagePrefs } from "../prefs";
import { folderRow, paperRow, rowKey, scopeRow } from "./treeRows";

export interface Tree {
  ui: LibraryUi;
  prefs: PagePrefs;
  el: HTMLElement;
  expanded: Set<string>;
  /** The focused row's key (see `rowKey`). */
  focused: string | null;
  selectedId: string | null;
  derived: { folders: readonly FolderTreeNode[]; papers: readonly PaperRecord[]; tree: LibraryTree } | null;
}

/** The derivation, rebuilt only when the folders or papers change. */
function derive(t: Tree): LibraryTree {
  const { folders, papers } = t.ui.store.get();
  if (t.derived?.folders !== folders || t.derived.papers !== papers) t.derived = { folders, papers, tree: libraryTree({ folders, papers }) };
  return t.derived.tree;
}

export function paintFocus(t: Tree): void {
  const active = document.activeElement === t.el;
  t.el.querySelectorAll<HTMLElement>(".tree-row").forEach((r) => r.classList.toggle("focused", active && rowKey(r) === t.focused));
  if (active) t.el.querySelector(".tree-row.focused")?.scrollIntoView({ block: "nearest" });
}

export function render(t: Tree): void {
  const tree = derive(t);
  const { folder, status, folders } = t.ui.store.get();
  const frag = document.createDocumentFragment();
  for (const { scope, count } of tree.scopes()) frag.append(scopeRow(scope, count, folder === PAPERS_DIR && status === scope));
  const walk = (path: string, depth: number): void => {
    for (const child of tree.children(path)) {
      if (child.kind === "paper") { frag.append(paperRow(child.id, child.title, depth, child.id === t.selectedId)); continue; }
      const expandable = tree.children(child.path).length > 0;
      const open = expandable && t.expanded.has(child.path);
      const r = folderRow(child.name, child.path, { depth, count: child.count, expandable, open, current: child.path === folder });
      t.ui.dropTarget(r, child.path);
      frag.append(r);
      if (open) walk(child.path, depth + 1);
    }
  };
  walk(PAPERS_DIR, 0);
  if (folders.length === 0) {
    frag.append(el("div", { class: "tree-empty", text: "No folders yet. Folders you create here also appear in the VS Code extension after the next sync." }));
  }
  t.el.replaceChildren(frag);
  paintFocus(t);
}

export function setExpanded(t: Tree, path: string, open: boolean): void {
  if (open) t.expanded.add(path); else t.expanded.delete(path);
  t.prefs.saveTreeExpanded([...t.expanded]);
  render(t);
}

/** Expands a folder and its ancestors without saving them, as VS Code's tree.reveal does. */
export function expandTo(t: Tree, path: string): void {
  for (let p = path; p !== PAPERS_DIR && isUnderDir(p, PAPERS_DIR, "/"); p = parentDir(p, "/")) t.expanded.add(p);
}

/** Marks a paper as selected and expands the folders that hold it; null clears the mark. */
export function markSelected(t: Tree, id: string | null): void {
  t.selectedId = id;
  const folder = id === null ? undefined : derive(t).parentOf(id);
  if (folder !== undefined) expandTo(t, folder);
  render(t);
}
