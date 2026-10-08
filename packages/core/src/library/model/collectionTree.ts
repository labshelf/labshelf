/** Collections as a tree of "/"-separated paths, derived from the file paths of a store that has no directory listing. */
import { METADATA_FILE, PAPERS_DIR, PDF_FILE } from "../layout.js";
import { countPapersUnder } from "./folderNavigation.js";
import { isUnderDir } from "../folderService.js";
import { nameCollator } from "./paperSort.js";
import type { LibrarySnapshot, PaperEntry } from "./types.js";

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
export function papersUnder(snapshot: LibrarySnapshot, rel: string): PaperEntry[] {
  if (!rel) { return [...snapshot.papers.values()]; }
  const prefix = rel + "/";
  return [...snapshot.papers.values()].filter((entry) => entry.collection === rel || entry.collection.startsWith(prefix));
}

/**
 * Builds the collection tree below `root`: every ancestor folder of a file path is a collection unless it holds a
 * paper (metadata.yaml or paper.pdf) or is hidden by a leading dot.
 * @returns the top-level collections, children sorted by name
 */
export function collectionsFromFilePaths(paths: readonly string[], root: string = PAPERS_DIR): FolderTreeNode[] {
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
export function pdfDirsFromFilePaths(paths: readonly string[]): Set<string> {
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
export function subfoldersOf(tree: readonly FolderTreeNode[], folder: string, root: string, paperPaths: readonly string[]): SubfolderEntry[] {
  const children = folder === root ? tree : findNode(tree, folder)?.children ?? [];
  return children.map((child) => ({ label: child.name, path: child.path, count: countPapersUnder(paperPaths, child.path, "/") }));
}
