/** Exports conflict-copy detection and the sidecar merge; scanning and resolving on disk live in node/. */
export { conflictOwnerLabel, conflictResolutions, type ConflictCopy, type ConflictOwner, type ConflictResolution, type SyncTool } from "./conflictCopy.js";
export { parseConflictName, type ParsedConflictName } from "./conflictNames.js";
export { mergeSidecars, type SidecarVersion } from "./sidecarMerge.js";
