/** Exports the Node side of conflict copies: scanning a library and applying a resolution. */
export { scanConflictCopies } from "./conflictScan.js";
export { resolveConflictCopy } from "./conflictResolution.js";
export { listPaperFolders, readConflictCopies } from "./readConflictCopies.js";
export { readDirOrEmpty } from "./readDirOrEmpty.js";
export { scanSpaceConflicts } from "./spaces/index.js";
export { resolveConflictDismissalFile, findProjectConflict, scanProjectContentConflicts, resolveProjectConflictCopy, type ProjectConflictResolutionContext } from './project/index.js';
