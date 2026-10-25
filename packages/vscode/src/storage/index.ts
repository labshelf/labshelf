// Exports the VS Code file system adapter for the library.
export { VscodeFileSystem, type UriOfPath } from "./vscodeFileSystem.js";
export { ExternalChangeWatcher } from "./externalChangeWatcher.js";
export { refreshLibrary } from "./refreshLibrary.js";
export type { ReindexSummary } from "./refreshLibrary.js";
export { migrateLibraryRootFromGlobalState } from "./libraryRootFromGlobalState.js";
