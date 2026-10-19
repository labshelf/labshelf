// Exports the browser storage layer's public API.
export { createLibraryFileSystem, getLibrarySource, recheckLibrarySource, rebuildFromFiles, setLibraryFolder, onLibraryFilesChanged, onFolderRecordsRebuilt, type LibrarySource } from "./libraryFileSystem";
export { createSidecarPort } from "./sidecarPort";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  upsertRecord,
  getRecord,
  listAllRecords,
} from "./paperRecordStore";
export { buildFolderTree, scanLibrary, pdfDirs } from "./folderTreeStore";
export { idbHistoryStorage } from "./idb";
export { stagePdf, stagedPdf, unstagePdf, keepStagedPdfs } from "./pdfStaging";
export { countBrowserPapers, moveBrowserLibraryToFolder } from "./move";
