// Exports the browser storage layer's public API.
export { createLibraryFileSystem, getLibrarySource, recheckLibrarySource, onLibraryFilesChanged, type LibrarySource } from "./libraryFileSystem";
export { createSidecarPort } from "./sidecarPort";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  upsertRecord,
  getRecord,
  listAllRecords,
} from "./paperRecordStore";
export { buildFolderTree, scanLibrary, pdfDirs } from "./folderTreeStore";
export { stagePdf, stagedPdf, unstagePdf, keepStagedPdfs } from "./pdfStaging";
export { rebuildFromFiles } from "./rebuild";
export { countBrowserPapers, moveBrowserLibraryToFolder } from "./move";
