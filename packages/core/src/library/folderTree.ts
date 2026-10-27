/** Computes everything about the folder tree of the library: paths for browsing it (breadcrumbs, labels, recursive
 * counts) and the tree derived from the file paths of a store that has no directory listing. Navigation functions take
 * the separator, so absolute file paths (VS Code) and "papers/..." store keys (browser) share one implementation. */
import { METADATA_FILE, PAPERS_DIR, PDF_FILE } from "./layout.js";
import { nameCollator } from "./paperOrder.js";
import type { LibrarySnapshot, PaperEntry } from "./libraryStore.js";

export const ROOT_LABEL = "All papers";
/** What a folder view and a paper's Folder field call the library root. */
export const LIBRARY_LABEL = "Library";

/** @returns whether `paperPath` is `dirPath` or lies beneath it, for the given separator */
export function isUnderDir(paperPath: string, dirPath: string, sep: string): boolean {
  return paperPath === dirPath || paperPath.startsWith(dirPath + sep);
}

export interface Crumb {
  label: string;
  path: string;
  isRoot: boolean;
}

/** @returns the parent folder of `path`; `path` itself when it has none */
export function deriveParentDir(path: string, sep: string): string {
  const index = path.lastIndexOf(sep);
  return index <= 0 ? path : path.slice(0, index);
}

/** @returns the last segment of `path` */
export function deriveBaseName(path: string, sep: string): string {
  return path.slice(path.lastIndexOf(sep) + sep.length);
}

/** @returns the root-first chain of folders from `root` down to `path`; just the root when `path` is outside it */
export function deriveBreadcrumb(root: string, path: string, sep: string): Crumb[] {
  const chain: Crumb[] = [{ label: ROOT_LABEL, path: root, isRoot: true }];
  if (path === root || !isUnderDir(path, root, sep)) { return chain; }
  let current = root;
  for (const segment of path.slice(root.length + sep.length).split(sep)) {
    current = current + sep + segment;
    chain.push({ label: segment, path: current, isRoot: false });
  }
  return chain;
}

/** @returns the name the UI shows for a folder: "All papers" for the root */
export function formatFolderLabel(root: string, path: string, sep: string): string {
  return path === root || path === "" ? ROOT_LABEL : deriveBaseName(path, sep);
}

/** @returns the folder's location inside the library as the UI shows it: "Thesis / Chapter 2", or "All papers" for the root */
export function formatFolderPathLabel(root: string, path: string, sep: string): string {
  if (path === root || !isUnderDir(path, root, sep)) { return ROOT_LABEL; }
  return path.slice(root.length + sep.length).split(sep).join(" / ");
}

/** @returns how many of `paperPaths` sit at any depth under `dir` */
export function countPapersUnder(paperPaths: readonly string[], dir: string, sep: string): number {
  let count = 0;
  for (const path of paperPaths) {
    if (isUnderDir(path, dir, sep)) { count++; }
  }
  return count;
}

/** @returns the folder holding the paper, relative to `dir` and joined with " / "; empty when the paper sits directly in `dir` */
export function deriveRelativeFolder(paperPath: string, dir: string, sep: string): string {
  const holder = deriveParentDir(paperPath, sep);
  if (holder === dir || !isUnderDir(holder, dir, sep)) { return ""; }
  return holder.slice(dir.length + sep.length).split(sep).join(" / ");
}


export interface FolderTreeNode {
  name: string;
  path: string;
  children: FolderTreeNode[];
}

export interface SubfolderEntry {
  label: string;
  path: string;
  /** Papers at any depth below. */
  count: number;
}

const PAPER_MARKERS: ReadonlySet<string> = new Set([METADATA_FILE, PDF_FILE]);

/** @returns the papers in a collection and every collection below it ("" is the whole library) */
export function listPapersUnderFolder(snapshot: LibrarySnapshot, rel: string): PaperEntry[] {
  if (!rel) { return [...snapshot.papers.values()]; }
  const prefix = rel + "/";
  return [...snapshot.papers.values()].filter((entry) => entry.collection === rel || entry.collection.startsWith(prefix));
}

/**
 * Builds the collection tree below `root`: every ancestor folder of a file path is a collection unless it holds a
 * paper (metadata.yaml or paper.pdf) or is hidden by a leading dot.
 * @returns the top-level collections, children sorted by name
 */
export function deriveFoldersFromFilePaths(paths: readonly string[], root: string = PAPERS_DIR): FolderTreeNode[] {
  const paperDirs = new Set<string>();
  const dirs = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.length > 1 && PAPER_MARKERS.has(parts[parts.length - 1]!)) { paperDirs.add(parts.slice(0, -1).join("/")); }
    for (let i = 1; i < parts.length; i++) { dirs.add(parts.slice(0, i).join("/")); }
  }
  const hidden = (dir: string): boolean => dir.split("/").some((segment, i) => i > 0 && segment.startsWith("."));
  const build = (dir: string): FolderTreeNode[] =>
    [...dirs]
      .filter((d) => d.startsWith(`${dir}/`) && !d.slice(dir.length + 1).includes("/") && !paperDirs.has(d) && !hidden(d))
      .sort((a, b) => nameCollator.compare(a, b))
      .map((path) => ({ name: path.slice(dir.length + 1), path, children: build(path) }));
  return build(root);
}

/**
 * Finds the folders that hold a paper.pdf. Only the exact name counts: conflict copies and backups do not.
 * @returns the paper folders with a PDF
 */
export function derivePdfDirs(paths: readonly string[]): Set<string> {
  const suffix = `/${PDF_FILE}`;
  const dirs = new Set<string>();
  for (const path of paths) {
    if (path.endsWith(suffix)) { dirs.add(path.slice(0, -suffix.length)); }
  }
  return dirs;
}

/** @returns the node at `path`; the root is the tree itself, so it is never found here */
export function findNode(tree: readonly FolderTreeNode[], path: string): FolderTreeNode | undefined {
  for (const node of tree) {
    if (node.path === path) { return node; }
    if (isUnderDir(path, node.path, "/")) { return findNode(node.children, path); }
  }
  return undefined;
}

/** @returns the direct sub-collections of `folder` with their recursive paper counts */
export function listSubfolders(tree: readonly FolderTreeNode[], folder: string, root: string, paperPaths: readonly string[]): SubfolderEntry[] {
  const children = folder === root ? tree : findNode(tree, folder)?.children ?? [];
  return children.map((child) => ({ label: child.name, path: child.path, count: countPapersUnder(paperPaths, child.path, "/") }));
}
