/** Exports the library model's public API: what a scan finds, the snapshot and store built on it, folder navigation, sorting and diffing. */
export { breadcrumbFor, baseName, isUnderDir, countPapersUnder, folderLabel, folderPathLabel, parentDir, relativeFolder, ROOT_LABEL } from "./folderNavigation.js";
export type { Crumb } from "./folderNavigation.js";
export { collectionsFromFilePaths, findNode, papersUnder, pdfDirsFromFilePaths, subfoldersOf } from "./collectionTree.js";
export type { FolderTreeNode, SubfolderEntry } from "./collectionTree.js";
export { LibraryStore } from "./libraryStore.js";
export type { LibraryEntry, LibraryStoreOptions, ListOptions } from "./libraryStore.js";
export { nameCollator, paperComparator, recordComparator } from "./paperSort.js";
export { diffPapers } from "./reindexDiff.js";
export type { PaperDiff } from "./reindexDiff.js";
export { emptySnapshot, snapshotFromScan } from "./snapshot.js";
export type {
  CollectionNode, LibraryScan, LibrarySnapshot, PaperEntry, PaperFilter, PaperSortKey, SortSpec,
} from "./types.js";
