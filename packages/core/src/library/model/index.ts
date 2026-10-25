/** Exports the library model's public API: what a scan finds, the snapshot and store built on it, folder navigation, sorting and diffing. */
export { deriveBreadcrumb, deriveBaseName, isUnderDir, countPapersUnder, formatFolderLabel, formatFolderPathLabel, deriveParentDir, deriveRelativeFolder, LIBRARY_LABEL, ROOT_LABEL } from "./folderNavigation.js";
export type { Crumb } from "./folderNavigation.js";
export { deriveFoldersFromFilePaths, findNode, listPapersUnderFolder, derivePdfDirs, listSubfolders } from "./folderTree.js";
export type { FolderTreeNode, SubfolderEntry } from "./folderTree.js";
export { LibraryStore } from "./libraryStore.js";
export type { LibraryEntry, LibraryStoreOptions, ListOptions } from "./libraryStore.js";
export { nameCollator, createPaperComparator, createPaperRecordComparator } from "./paperSort.js";
export { comparePapers } from "./paperDiff.js";
export type { PaperDiff } from "./paperDiff.js";
export { createEmptySnapshot, deriveSnapshot } from "./snapshot.js";
export type {
  FolderNode, LibraryScan, LibrarySnapshot, PaperEntry, PaperFilter, PaperSortColumn, SortSpec,
} from "./librarySnapshot.js";
