// Barrel re-export for all sync/engine public symbols.
export type {
  ManifestEntry,
  ManifestData,
  DiffClass,
  TreeNode,
  SyncOperation,
  NamespaceResult,
  SyncResult,
} from "./syncTypes.js";
export { SyncManifest, summarizeSyncResult, writeSyncRunRecord, readSyncRunRecord, SyncLock, parseSyncLock } from "./state/index.js";
export type { SyncRunRecord, SyncLockOwner, SyncLockInfo, SyncLockOptions, SyncLockAttempt } from "./state/index.js";
export { scanLocalTree, scanRemoteTree, diffNamespace, applyOperations, SyncEngine } from "./pipeline/index.js";
export type { RemoteFolderNamer, ApplyContext, SyncEngineDeps, NamespaceRoots, FolderNameMaps } from "./pipeline/index.js";
export { createLibraryFolderNamer, isSafeFolderName, buildLibraryFolderNames, driveFolderName } from "./naming/index.js";
export type { LibraryFolderNamerDeps } from "./naming/index.js";
