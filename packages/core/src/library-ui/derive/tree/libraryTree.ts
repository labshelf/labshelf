// Derives the library tree the host shows: status scopes with counts, and each folder's subfolders then papers.
import { PAPERS_DIR, parentDir, type FolderTreeNode } from "../../../library/index.js";
import type { PaperRecord } from "../../../model/index.js";
import type { StatusFilter } from "../../state/index.js";

export type TreeChild =
  | { kind: "folder"; name: string; path: string; count: number }
  | { kind: "paper"; id: string; title: string };

export interface LibraryTree {
  /** All papers, then Unread, Reading and Done, each with its paper count. */
  scopes(): Array<{ scope: StatusFilter; count: number }>;
  /** The subfolders of a folder with their recursive paper counts, then its own papers by title; computed on demand. */
  children(path: string): TreeChild[];
  /** The folder that holds a paper; undefined for an unknown id. */
  parentOf(id: string): string | undefined;
}

const SCOPES: StatusFilter[] = ["all", "unread", "reading", "done"];
const byTitle = (a: PaperRecord, b: PaperRecord): number => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });

export function libraryTree(input: { folders: readonly FolderTreeNode[]; papers: readonly PaperRecord[] }): LibraryTree {
  // Indexed once: thousands of papers must not be scanned per expanded folder.
  const papersIn = new Map<string, PaperRecord[]>();
  const folderOf = new Map<string, string>();
  for (const p of input.papers) {
    const dir = parentDir(p.path, "/");
    folderOf.set(p.id, dir);
    const list = papersIn.get(dir);
    if (list) list.push(p); else papersIn.set(dir, [p]);
  }
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
    scopes: () => SCOPES.map((scope) => ({ scope, count: scope === "all" ? input.papers.length : input.papers.filter((p) => p.status === scope).length })),
    children: (path) => [
      ...(subfolders.get(path) ?? []).map((f): TreeChild => ({ kind: "folder", name: f.name, path: f.path, count: counts.get(f.path) ?? 0 })),
      ...[...(papersIn.get(path) ?? [])].sort(byTitle).map((p): TreeChild => ({ kind: "paper", id: p.id, title: p.title })),
    ],
    parentOf: (id) => folderOf.get(id),
  };
}
