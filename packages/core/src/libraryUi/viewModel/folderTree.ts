// Builds the folder tree the library UI shows from the snapshot's collections, empty folders included.
import { PAPERS_DIR, type FolderTreeNode, type LibrarySnapshot } from "../../library/index.js";

export interface CountedFolder extends FolderTreeNode {
  /** Papers in this folder and every folder below it. */
  total: number;
  children: CountedFolder[];
}

/** @returns the top-level folders with their sub-folders, in the snapshot's name order; paths start at papers */
export function folderTreeFromSnapshot(snapshot: LibrarySnapshot): CountedFolder[] {
  const build = (rels: readonly string[]): CountedFolder[] =>
    rels.flatMap((rel) => {
      const node = snapshot.collections.get(rel);
      return node ? [{ name: node.name, path: `${PAPERS_DIR}/${rel}`, total: node.total, children: build(node.children) }] : [];
    });
  return build(snapshot.collections.get("")?.children ?? []);
}
