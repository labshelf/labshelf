/**
 * Flattens every folder for a picker and checks the name of a new or renamed folder.
 */
import { PAPERS_DIR, findNode, validateFolderName, type FolderTreeNode } from "../../library/index.js";
import type { PaperRecord } from "../../model/index.js";

/** Every folder path in the tree, parents before children, labelled by the path below the root. */
export function flattenFolders(tree: readonly FolderTreeNode[]): Array<{ label: string; path: string }> {
  const out: Array<{ label: string; path: string }> = [];
  const walk = (nodes: readonly FolderTreeNode[]): void => {
    for (const n of nodes) { out.push({ label: n.path.slice(PAPERS_DIR.length + 1).split("/").join(" / "), path: n.path }); walk(n.children); }
  };
  walk(tree);
  return out;
}

interface FolderContext {
  folders: readonly FolderTreeNode[];
  papers: readonly PaperRecord[];
}

/** The core name rule plus a sibling collision check; `current` is the name being renamed, which stays allowed. */
export function folderNameProblem(lib: FolderContext, parent: string, name: string, current?: string): string | null {
  const invalid = validateFolderName(name);
  if (invalid) return invalid;
  const trimmed = name.trim();
  if (trimmed === current) return null;
  const siblings = parent === PAPERS_DIR ? lib.folders : findNode(lib.folders, parent)?.children ?? [];
  if (siblings.some((s) => s.name.toLowerCase() === trimmed.toLowerCase())) return `A folder named "${trimmed}" already exists here.`;
  if (lib.papers.some((p) => p.path === `${parent}/${trimmed}`)) return "A paper already uses that name here.";
  return null;
}
