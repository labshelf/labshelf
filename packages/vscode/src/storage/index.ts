// Exports the VS Code file system adapter for the library.
export { VscodeFileSystem, type UriOfPath } from "./vscodeFileSystem.js";
export { ExternalChangeWatcher } from "./externalChangeWatcher.js";
export { reindexLibrary } from "./reindexLibrary.js";
export type { ReindexSummary } from "./reindexLibrary.js";
export { migrateLibraryRootFromGlobalState } from "./libraryRootFromGlobalState.js";
