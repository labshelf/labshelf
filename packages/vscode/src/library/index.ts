/** Exports the library host: its services, change events, file system and watcher, location flows, and the conflict and sync guide commands. */
export { ConflictHandling, registerConflictCommand } from "./conflicts.js";
export { registerSyncGuideCommand } from "./syncGuide.js";
export { PaperImporter, PaperTextLayers, type CreateTextLayerResult } from "./import.js";
export { createLibraryEvents, onPaperChange, type LibraryEvents } from "./events.js";
export { VscodeFileSystem, ExternalChangeWatcher, pdfFileExists, type UriOfPath } from "./fileSystem.js";
export {
  ensureLibraryStructure,
  moveLibraryRootToConfig,
  refreshLibrary,
  resolveLibraryRoot,
  type RefreshLibraryResult,
  type SharedLibraryConfig,
} from "./location.js";
