/** Exports conflict-copy detection and the sidecar merge; scanning and resolving on disk live in node/. */
export {
  formatConflictOwnerLabel, deriveConflictResolutions, parseConflictName, listConflictAskChoices, describeContentConflict,
  readConflictDismissals, writeProjectConflictDismissal,
  type ConflictCopy, type ConflictOwner, type ConflictResolution, type SyncTool, type ParsedConflictCopy,
  type ConflictAskChoice, type ConflictAskResolution, type ConflictDismissal,
} from "./conflictCopy.js";
export { mergeSidecars, type SidecarVersion } from "./sidecarMerge.js";
export { hasMergeableExtension, isItemFileName, isMergeableTextFile, type IProjectVersionStore, type ProjectWriteTracking } from "./mergeBase.js";
export { isExternalChangeNoise, applyChangeBatch, LibraryRootPresenceMonitor, type ChangeBatchDeps, type LibraryRootPresenceDeps } from "./externalChange.js";
export { syncGuide, type SyncGuide, type SyncGuidePlatform, type SyncGuideTool } from "./syncGuide.js";
