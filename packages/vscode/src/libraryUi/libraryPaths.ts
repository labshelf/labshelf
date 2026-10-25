/**
 * Maps the library's folders on disk to the "/"-separated paths the library UI uses, which start at "papers", and
 * back. The UI never sees an absolute path.
 */
import { PAPERS_DIR, isUnderDir, type PathOps } from '@labshelf/core';

export interface LibraryPaths {
  /** The absolute papers/ folder. */
  root: string;
  /** @returns the UI path of a folder or paper under papers/, or null for anything outside it */
  toUi(abs: string): string | null;
  /** @returns the absolute path of a UI path the message guards accepted */
  fromUi(ui: string): string;
}

export function libraryPaths(root: string, { sep, join }: PathOps): LibraryPaths {
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
