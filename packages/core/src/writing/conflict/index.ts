// Exposes project text history and three-way merging.
export { FileProjectVersionStore } from "./fileProjectVersionStore.js";
export type { IProjectVersionStore, ProjectWriteTracking } from "./projectVersionStore.js";
export { hasMergeableExtension, isItemFileName, isMergeableTextFile } from "./mergeableTextFile.js";
export { deriveTextHash } from "./versionJournal.js";
