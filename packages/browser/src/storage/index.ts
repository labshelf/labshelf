// Exports the browser storage layer's public API.
export { createLibraryFileSystem, getLibrarySource, librarySources, recheckLibrarySource, rebuildFromFiles, setLibraryFolder, switchToPickedFolder, onLibraryFilesChanged, onFolderRecordsRebuilt, type LibrarySource, type LibrarySources } from "./libraryFileSystem";
export { currentLibraryId, libraryIdOf } from "./identity";
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
export { announcePickedFolder, folderPermission, loadPickedFolder, requestFolderPermission, savePickedFolder } from "./picked";
export { deleteBrowserCollabState, openBrowserCollabStorage } from "./collaboration";
export { acquireTabLease, takeOverTabLease, tabLeaseName, waitForTabLease, type TabLease, type TabLeaseResult } from "./ownership";
