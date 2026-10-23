/** Exports the Node side of conflict copies: scanning a library and applying a resolution. */
export { scanConflictCopies } from "./conflictScan.js";
export { resolveConflictCopy } from "./conflictResolution.js";
export { readDirOrEmpty } from "./readDirOrEmpty.js";
export { scanSpaceConflicts } from "./spaceConflictScan.js";
export { conflictDismissalFile, findProjectConflict, scanProjectContentConflicts, resolveProjectConflictCopy, type ProjectConflictResolutionContext } from './project/index.js';
