/** Declares the folder node shared by the Library sidebar and the list panel. */
import { ROOT_LABEL } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself (the list panel's root).
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

/** Builds the node that represents papers/ itself. */
export function rootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}
