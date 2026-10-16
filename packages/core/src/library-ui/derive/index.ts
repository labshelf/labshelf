/** Exports the library UI derivations' public API: list rows, scope, sorting, folders, the folder tree, text layers, related papers, sidecar summaries. */
export { listPapersUnder, papersInScope } from "./listPapers.js";
export type { ListPaper } from "./listPapers.js";
export { firstSortDir, sortPapers } from "./sortPapers.js";
export { flattenFolders, folderNameProblem } from "./folders.js";
export { folderTreeFromSnapshot } from "./folderTree.js";
export type { CountedFolder } from "./folderTree.js";
export { deriveListView, deriveScope } from "./listView.js";
export type { ListScope, ListView } from "./listView.js";
export { hasNoText, jobProgress, jobText, textLayerSummary } from "./textLayer.js";
export { relatedGroups } from "./related.js";
export type { RelatedGroups } from "./related.js";
export { paperDetailsOf, paperStatsOf } from "./sidecarSummary.js";
export type { SidecarSummarySource } from "./sidecarSummary.js";
export { noteFact, paperFileFact } from "./facts/index.js";
export { libraryTree } from "./tree/index.js";
export type { LibraryTree, TreeChild } from "./tree/index.js";
