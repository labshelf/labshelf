/**
 * The folder node the Library tree and the list panel share: a collection folder under papers/, or papers/ itself.
 */
import { ROOT_LABEL } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself.
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

/** Builds the node that represents papers/ itself. */
export function rootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}
