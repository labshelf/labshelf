/** Exports the Node side of project merging: the library-wide conflict scan and the three-way text merge. */
export { scanLibraryConflicts } from "./libraryConflictScan.js";
export { mergeText, type TextMergeInput, type TextMergeResult } from "./mergeText.js";
