/** Exports the library model's public API: what a scan finds, the snapshot and store built on it, folder navigation, sorting and diffing. */
export { breadcrumbFor, baseName, isUnderDir, countPapersUnder, folderLabel, folderPathLabel, parentDir, relativeFolder, LIBRARY_LABEL, ROOT_LABEL } from "./folderNavigation.js";
export type { Crumb } from "./folderNavigation.js";
export { collectionsFromFilePaths, findNode, papersUnder, pdfDirsFromFilePaths, subfoldersOf } from "./folderTree.js";
export type { FolderTreeNode, SubfolderEntry } from "./folderTree.js";
export { LibraryStore } from "./libraryStore.js";
export type { LibraryEntry, LibraryStoreOptions, ListOptions } from "./libraryStore.js";
export { nameCollator, paperComparator, recordComparator } from "./paperSort.js";
export { diffPapers } from "./paperDiff.js";
export type { PaperDiff } from "./paperDiff.js";
export { emptySnapshot, snapshotFromScan } from "./snapshot.js";
export type {
  CollectionNode, LibraryScan, LibrarySnapshot, PaperEntry, PaperFilter, PaperSortKey, SortSpec,
} from "./librarySnapshot.js";
