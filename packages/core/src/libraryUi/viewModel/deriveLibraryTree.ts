// Derives the library tree the host shows: the paper total, and each folder's subfolders then papers.
import { PAPERS_DIR, type FolderTreeNode } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";

export type TreeChild =
  | { kind: "folder"; name: string; path: string; count: number }
  | { kind: "paper"; id: string; title: string };

export interface LibraryTree {
  /** The number of papers in the whole library. */
  total(): number;
  /** The subfolders of a folder with their recursive paper counts, then its own papers by title; computed on demand. */
  children(path: string): TreeChild[];
  /** The folder that holds a paper; undefined for an unknown id. */
  parentOf(id: string): string | undefined;
}

/** The fields the tree reads, so a host can send slim records. */
export type TreePaper = Pick<PaperRecord, "id" | "title" | "status" | "tags">;

const byTitle = (a: TreePaper, b: TreePaper): number => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

/**
 * Each paper's `folder` is keyed like `FolderTreeNode.path`: `PAPERS_DIR` for the root, `papers/A/B` below.
 * TRAP: the caller supplies it because `record.path` is absolute in a Node scan and relative in the browser.
 */
export function deriveLibraryTree(input: { folders: readonly FolderTreeNode[]; papers: readonly { record: TreePaper; folder: string }[] }): LibraryTree {
  // Indexed once: thousands of papers must not be scanned per expanded folder.
  const papersIn = new Map<string, TreePaper[]>();
  const folderOf = new Map<string, string>();
  input.papers.forEach(({ record, folder }) => {
    folderOf.set(record.id, folder);
    const list = papersIn.get(folder);
    if (list) list.push(record); else papersIn.set(folder, [record]);
  });
  const subfolders = new Map<string, readonly FolderTreeNode[]>([[PAPERS_DIR, input.folders]]);
  const counts = new Map<string, number>();
  const count = (node: FolderTreeNode): number => {
    subfolders.set(node.path, node.children);
    const total = (papersIn.get(node.path)?.length ?? 0) + node.children.reduce((sum, c) => sum + count(c), 0);
    counts.set(node.path, total);
    return total;
  };
  input.folders.forEach(count);

  return {
    total: () => input.papers.length,
    children: (path) => [
      ...(subfolders.get(path) ?? []).map((f): TreeChild => ({ kind: "folder", name: f.name, path: f.path, count: counts.get(f.path) ?? 0 })),
      ...[...(papersIn.get(path) ?? [])].sort(byTitle).map((p): TreeChild => ({ kind: "paper", id: p.id, title: p.title })),
    ],
    parentOf: (id) => folderOf.get(id),
  };
}
