/** Public API of the terminal's library folder: the library on disk, the store over it, search and paper operations. */
export { rankFuzzy } from "./fuzzy.js";
export { LibraryRoot, ensureLibraryStructure, looksLikeLibrary } from "./libraryRoot.js";
export { createLibraryStore, scanLibraryOnDisk } from "./libraryModel.js";
export { LibraryWatcher } from "./libraryWatcher.js";
export { TerminalPaperService } from "./papers/index.js";
export { PaperSearchIndex } from "./paperSearchIndex.js";
export { matchPaper, parseQuery, searchDoc } from "./search.js";
export { SidecarReader } from "./sidecars.js";
