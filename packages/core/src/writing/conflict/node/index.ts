/** Exports the Node side of project merging: the library-wide conflict scan and the text merge bound to node-diff3. */
export { scanLibraryConflicts } from "./libraryConflictScan.js";
export { mergeFileText, mergeText } from "./mergeText.js";
export { addProjectWrite, type ProjectWrite } from "./projectWriteRecord.js";
export { createProjectWriteTracking } from "./projectWriteTracking.js";
export { mergeProjectContentCopy } from './projectCopyMerge.js';
export { scanSharedProjectConflicts } from './projectConflictScan.js';
