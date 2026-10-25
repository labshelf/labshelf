/** Exports conflict-copy detection and the sidecar merge; scanning and resolving on disk live in node/. */
export { conflictOwnerLabel, conflictResolutions, type ConflictCopy, type ConflictOwner, type ConflictResolution, type SyncTool } from "./conflictCopy.js";
export { parseConflictName, type ParsedConflictName } from "./conflictNames.js";
export { mergeSidecars, type SidecarVersion } from "./sidecarMerge.js";

export { detectProjectConflict, eligibleProjectConflictPath, VERSION_SIMILARITY, type ProjectConflictText, type ProjectConflictInput } from './projectConflict.js';
export { readConflictDismissals, dismissProjectConflict, type ConflictDismissal } from './conflictDismissals.js';
export { conflictPromptChoices, contentConflictMessage, type ConflictPromptChoice, type ConflictPromptResolution } from './askConflict.js';
