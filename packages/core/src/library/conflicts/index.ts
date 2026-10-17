/** Exports conflict-copy detection and the sidecar merge; scanning and resolving on disk live in node/. */
export type { ConflictCopy, ConflictResolution, SyncTool } from "./conflictCopy.js";
export { parseConflictName, type ParsedConflictName } from "./conflictNames.js";
export { mergeSidecars, type SidecarVersion } from "./sidecarMerge.js";
