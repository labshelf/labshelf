// Barrel for the scan → diff → apply → orchestrate sync run pipeline.
export { scanLocalTree, scanRemoteTree } from "./treeScan.js";
export type { RemoteFolderNamer, FolderNaming } from "./treeScan.js";
export { diffNamespace } from "./syncDiff.js";
export { applyOperations } from "./syncApply.js";
export type { ApplyContext } from "./syncApply.js";
export { SyncEngine } from "./syncEngine.js";
export type { SyncEngineDeps, NamespaceRoots, FolderNameMaps } from "./syncEngine.js";
