// Exposes project text history and three-way merging.
export { FileProjectVersionStore } from "./fileProjectVersionStore.js";
export type { IProjectVersionStore, ProjectSaveTracking } from "./projectVersionStore.js";
export { hasMergeableExtension, isItemFileName, isMergeableTextFile } from "./mergeableTextFile.js";
export { textHash } from "./versionJournal.js";
