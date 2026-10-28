// Exports the browser storage layer's public API.
export { createLibraryFileSystem, createLibraryMutations, readLibraryLocation, readLibraryLocations, refreshStoredLibraryLocation, refreshFromFiles, setLibraryFolder, attachPickedDir, onLibraryFilesChanged, onPaperRecordsRebuilt, type LibraryMutations, type LibraryLocation, type LibraryLocations } from "./libraryFileSystem";
export { readCachedPaperRecord, listCachedPaperRecords, buildFolderTree, scanLibrary, listPdfDirs, readCurrentLibraryId, createSidecarPort, createBrowserProjects, type BrowserProjects } from "./records";
export { createIdbHistoryStorage } from "./idb";
export { writeStagedPdf, readStagedPdf, removeStagedPdf, removeStagedPdfsExcept } from "./staging";
export { countBrowserPapers, moveBrowserLibraryToFolder, sendPickedDirChange, readFolderPermission, readPickedDir, askFolderPermission, writePickedDir } from "./library";
export { createBrowserDeviceIdentity, removeBrowserCollabDocs, openBrowserCollabStorage } from "./collab";
export { openTabLease, updateTabLease, createTabLeaseName, watchTabLease, type TabLease } from "./tabLease";
