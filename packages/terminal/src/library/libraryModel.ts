/** Connects the core library model to the terminal: scans papers/ through node:fs and builds the store over it. */
import * as path from "node:path";

import { LibraryStore, scanLibrary, type ILogger, type LibraryScan, type PaperEntry } from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";

import type { LibraryRoot } from "./libraryRoot.js";

// A scan only reads, so the trash is never reached.
const scanFileSystem = new NodeLibraryFileSystem();

/** @returns what is on disk under papers/ right now */
function scanLibraryOnDisk(paths: LibraryRoot, logger: ILogger, previous: ReadonlyMap<string, PaperEntry>): Promise<LibraryScan> {
  return scanLibrary(scanFileSystem, path, paths.layout.papersRoot(), logger, previous);
}

export function createLibraryStore(paths: LibraryRoot, logger: ILogger): LibraryStore {
  return new LibraryStore({
    root: paths.root,
    scan: (previous) => scanLibraryOnDisk(paths, logger, previous),
  });
}
