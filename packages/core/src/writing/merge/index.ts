// Exposes project text history and three-way merging.
export { FileProjectVersionStore } from "./fileProjectVersionStore.js";
export type { IProjectVersionStore, ProjectSaveTracking } from "./projectVersionStore.js";
export { hasMergeableExtension, isMergeableTextFile } from "./mergeableTextFile.js";
export { createTextMerge } from "./textMerge.js";
export { lineSimilarity } from "./lineSimilarity.js";
export { textHash } from "./versionJournal.js";
