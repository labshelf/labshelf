/** Connects the core library model to the terminal: scans papers/ through node:fs and builds the store with the terminal's search. */
import * as path from "node:path";

import { LibraryStore, scanLibrary, type ILogger, type LibraryScan } from "@labshelf/core";
import { NodeLibraryFileSystem } from "@labshelf/core/node";

import type { LibraryRoot } from "./libraryRoot.js";
import type { PaperSearchIndex } from "./paperSearchIndex.js";

// A scan only reads, so the trash is never reached.
const scanFileSystem = new NodeLibraryFileSystem(async () => { throw new Error("The library scan does not trash files"); });

/** @returns what is on disk under papers/ right now */
export function scanLibraryOnDisk(paths: LibraryRoot, logger: ILogger): Promise<LibraryScan> {
  return scanLibrary(scanFileSystem, path, paths.layout.papersRoot(), logger);
}

export function createLibraryStore(paths: LibraryRoot, logger: ILogger, search: PaperSearchIndex): LibraryStore {
  return new LibraryStore({
    root: paths.root,
    scan: () => scanLibraryOnDisk(paths, logger),
    filterFor: search.filterFor,
  });
}
