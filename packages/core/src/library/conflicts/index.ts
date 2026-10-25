/** Exports conflict-copy detection and the sidecar merge; scanning and resolving on disk live in node/. */
export { formatConflictOwnerLabel, deriveConflictResolutions, type ConflictCopy, type ConflictOwner, type ConflictResolution, type SyncTool } from "./conflictCopy.js";
export { parseConflictName, type ParsedConflictName } from "./conflictNames.js";
export { mergeSidecars, type SidecarVersion } from "./sidecarMerge.js";

export { detectProjectConflict, isEligibleProjectConflictPath, VERSION_SIMILARITY, type ProjectConflictText, type ProjectConflictInput } from './projectConflict.js';
export { readConflictDismissals, writeProjectConflictDismissal, type ConflictDismissal } from './conflictDismissals.js';
export { listConflictAskChoices, describeContentConflict, type ConflictAskChoice, type ConflictAskResolution } from './askConflict.js';
