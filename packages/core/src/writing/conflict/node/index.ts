/** Exports the Node side of project merging: the library-wide conflict scan, project copy resolution and the text merge bound to node-diff3. */
export { scanLibraryConflicts, scanSharedProjectConflicts } from "./projectConflictScan.js";
export { mergeFileText, mergeText } from "./itemFileMerge.js";
export { addProjectWrite, createProjectWriteTracking, type ProjectWrite } from "./projectWrite.js";
export {
  mergeProjectContentCopy, resolveConflictDismissalFile, findProjectConflict, resolveProjectConflictCopy,
  type ProjectConflictResolutionContext,
} from "./projectConflicts.js";
