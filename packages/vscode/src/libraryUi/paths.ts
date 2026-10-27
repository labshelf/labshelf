/**
 * Maps the library's folders on disk to the "/"-separated paths the library UI uses, which start at "papers", and
 * back (the UI never sees an absolute path), and declares the folder node the Library sidebar and the list panel share.
 */
import { PAPERS_DIR, ROOT_LABEL, isUnderDir, type PathOps } from '@labshelf/core';

// A node is a "collection folder": a real directory under papers/ that is not
// itself a paper folder. The root node stands for papers/ itself (the list panel's root).
export interface LibraryNode {
  label: string;
  dirPath: string;
  isRoot?: boolean;
}

/** Builds the node that represents papers/ itself. */
export function createLibraryRootNode(rootDir: string): LibraryNode {
  return { label: ROOT_LABEL, dirPath: rootDir, isRoot: true };
}


export interface LibraryPaths {
  /** The absolute papers/ folder. */
  root: string;
  /** @returns the UI path of a folder or paper under papers/, or null for anything outside it */
  toUi(abs: string): string | null;
  /** @returns the absolute path of a UI path the message guards accepted */
  fromUi(ui: string): string;
}

export function createLibraryPaths(root: string, { sep, join }: PathOps): LibraryPaths {
  return {
    root,
    toUi(abs) {
      if (abs === root) { return PAPERS_DIR; }
      return isUnderDir(abs, root, sep) ? [PAPERS_DIR, ...abs.slice(root.length + 1).split(sep)].join('/') : null;
    },
    fromUi(ui) {
      const below = ui.split('/').slice(1);
      return below.length ? join(root, ...below) : root;
    },
  };
}
