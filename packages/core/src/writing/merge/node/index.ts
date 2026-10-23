/** Exports the Node side of project merging: the library-wide conflict scan and the text merge bound to node-diff3. */
export { scanLibraryConflicts } from "./libraryConflictScan.js";
export { mergeText } from "./mergeText.js";
export { recordProjectSave, type ProjectSave } from "./projectSaveRecord.js";
export { createProjectSaveTracking } from "./projectSaveTracking.js";
export { mergeProjectContentCopy } from './projectCopyMerge.js';
export { scanSharedProjectConflicts } from './projectConflictScan.js';
