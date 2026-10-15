/** Exports the terminal library module's public API: the library on disk, the store over it, the search index and paper operations. */
export { LibraryRoot, ensureLibraryStructure, looksLikeLibrary } from "./libraryRoot.js";
export { createLibraryStore, scanLibraryOnDisk } from "./libraryModel.js";
export { LibraryWatcher } from "./libraryWatcher.js";
export { TerminalPaperService } from "./papers/index.js";
export { PaperSearchIndex } from "./paperSearchIndex.js";
export { SidecarReader } from "./sidecars.js";
