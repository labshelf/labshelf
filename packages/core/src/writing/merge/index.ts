/** Exports the merge base port, its file store, the rule for which project files have a base, and the line-by-line text merge. */
export { FileMergeBaseStore } from "./fileMergeBaseStore.js";
export type { IMergeBaseStore } from "./mergeBaseStore.js";
export { hasMergeableExtension, isMergeableTextFile } from "./mergeableTextFile.js";
export { createTextMerge } from "./textMerge.js";
export { lineSimilarity } from "./lineSimilarity.js";
