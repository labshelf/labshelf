/** Exports the library domain's public API: folders, paper metadata, reading status and the on-disk layout. */
export { movePapersUnder, removePapersUnder, LibraryStore, createEmptySnapshot, deriveSnapshot } from "./libraryStore.js";
export type {
  IPaperRecordCache, LibraryEntry, LibraryStoreOptions, ListOptions,
  FolderNode, LibraryScan, LibrarySnapshot, PaperEntry, PaperFilter, PaperSortColumn, SortSpec,
} from "./libraryStore.js";
export {
  deriveBreadcrumb, deriveBaseName, isUnderDir, countPapersUnder, formatFolderLabel, formatFolderPathLabel, deriveParentDir, deriveRelativeFolder, LIBRARY_LABEL, ROOT_LABEL,
  deriveFoldersFromFilePaths, findNode, listPapersUnderFolder, derivePdfDirs, listSubfolders,
} from "./folderTree.js";
export type { Crumb, FolderTreeNode, SubfolderEntry } from "./folderTree.js";
export { nameCollator, createPaperComparator, createPaperRecordComparator, comparePapers } from "./paperOrder.js";
export type { PaperDiff } from "./paperOrder.js";
export { describePaperFile, describePaperFileOnFileSystem, listPaperFiles } from "./paperFiles.js";
export type { PaperFile, PaperFilesState } from "./paperFiles.js";
export * from "./record.js";
export { deriveCiteKeySlug, ensureCiteKey, createCiteKey, deriveUniqueCiteKey } from "./citeKey.js";
export type { CiteKeyMetadata } from "./citeKey.js";
export { FOLDER_NAME_MAX_LENGTH, checkFolderName, scanLibrary } from "./folders.js";
export type { ScanFileSystem } from "./folders.js";
export {
  PAPERS_DIR, RESEARCH_DIR, PROJECTS_DIR, SPACES_DIR,
  PDF_FILE, METADATA_FILE, BIB_FILE, SIDECAR_FILE, PAPER_NOTES_FILE, SPACE_FILE, GLOSSARY_FILE,
  joinWith, createLibraryLayout, createPaperFiles,
  SHARED_CONFIG_VERSION, mergeSharedConfig, parseSharedConfig, serializeSharedConfig,
} from "./layout.js";
export type { Join, LibraryLayout, PaperFiles, SharedConfig, SharedConfigUpdate } from "./layout.js";
export * from "./mutations/index.js";
export * from "./search.js";
export * from "./searchText.js";
export * from "./conflicts/index.js";
