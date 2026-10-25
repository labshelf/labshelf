/** Exports the terminal library module's public API: the library on disk, the store over it and paper operations. */
export { LibraryRoot, ensureLibraryStructure, isLibraryRoot } from "./libraryRoot.js";
export { createLibraryStore } from "./libraryModel.js";
export { LibraryWatcher } from "./libraryWatcher.js";
export { ConflictFeed } from "./conflictFeed.js";
export { TerminalPaperService } from "./paperService.js";
export { SidecarReader } from "./sidecars.js";
