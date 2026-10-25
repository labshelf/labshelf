// Exports the browser storage layer's public API.
export { createLibraryFileSystem, readLibraryLocation, readLibraryLocations, refreshStoredLibraryLocation, refreshFromFiles, setLibraryFolder, attachPickedDir, onLibraryFilesChanged, onPaperRecordsRebuilt, type LibraryLocation, type LibraryLocations } from "./libraryFileSystem";
export { readCurrentLibraryId, deriveLibraryId } from "./libraryIdentity";
export { createSidecarPort } from "./sidecarPort";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  writeCachedPaperRecord,
  readCachedPaperRecord,
  listCachedPaperRecords,
} from "./paperRecordStore";
export { buildFolderTree, scanLibrary, listPdfDirs } from "./folderTreeStore";
export { createIdbHistoryStorage } from "./createIdbHistoryStorage";
export { writeStagedPdf, readStagedPdf, removeStagedPdf, removeStagedPdfsExcept } from "./pdfStaging";
export { countBrowserPapers, moveBrowserLibraryToFolder } from "./libraryLocation";
export { sendPickedDirChange, readFolderPermission, readPickedDir, askFolderPermission, writePickedDir } from "./pickedDir";
export { createBrowserDeviceIdentity, removeBrowserCollabDocs, openBrowserCollabStorage } from "./collab";
export { createBrowserProjects, type BrowserProjects } from "./browserProjects";
export { openTabLease, updateTabLease, createTabLeaseName, watchTabLease, type TabLease, type TabLeaseResult } from "./tabLease";
