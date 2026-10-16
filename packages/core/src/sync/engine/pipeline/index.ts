// Exports the sync run pipeline's public API.
// The pipeline scans, diffs and applies, orchestrated by SyncEngine.
export { scanLocalTree, scanRemoteTree } from "./treeScan.js";
export { isIgnoredProjectPath } from "./projectIgnore.js";
export type { RemoteFolderNamer, FolderNaming } from "./treeScan.js";
export { diffNamespace } from "./syncDiff.js";
export { applyOperations } from "./syncApply.js";
export type { ApplyContext } from "./syncApply.js";
export { SyncEngine } from "./syncEngine.js";
export type { SyncEngineDeps, NamespaceRoots, FolderNameMaps } from "./syncEngine.js";
