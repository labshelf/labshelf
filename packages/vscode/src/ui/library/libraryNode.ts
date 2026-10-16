/**
 * Declares the rows of the Library tree: folders (shared with the list panel), status scopes and papers.
 */
import { ROOT_LABEL, type StatusFilter } from '@labshelf/core';
import type { ContinueNode } from './continueNode.js';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself (the list panel's root).
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

/** A status scope row: opens the list on every paper of that status. */
export interface ScopeNode {
  scope: StatusFilter;
  count: number;
}

/** A paper row inside its folder. */
export interface PaperNode {
  paperId: string;
  title: string;
}

/** A row of the Library tree. */
export type LibraryTreeNode = LibraryNode | ContinueNode | ScopeNode | PaperNode;

export function isFolderNode(node: LibraryTreeNode): node is LibraryNode {
  return 'dirPath' in node;
}

/** Builds the node that represents papers/ itself. */
export function rootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}
