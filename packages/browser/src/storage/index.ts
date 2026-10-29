// Exports the browser storage layer's public API.
export { createLibraryFileSystem, readLibraryLocation, readLibraryLocations, refreshFromFiles, onLibraryFilesChanged, onPaperRecordsRebuilt, type LibraryLocation, type LibraryLocations } from "./libraryFileSystem";
export { createLibraryMutations, type LibraryMutations } from "./libraryMutations";
export { readCachedPaperRecord, listCachedPaperRecords, buildFolderTree, scanLibrary, listPdfDirs, readCurrentLibraryId, createSidecarPort, createPaperNotesPort, createBrowserProjects, type BrowserProjects } from "./records";
export { createIdbHistoryStorage } from "./idb";
export { writeStagedPdf, readStagedPdf, removeStagedPdf, removeStagedPdfsExcept } from "./staging";
export { createBrowserDeviceIdentity, removeBrowserCollabDocs, openBrowserCollabStorage } from "./collab";
export { openTabLease, updateTabLease, createTabLeaseName, watchTabLease, type TabLease } from "./tabLease";
export { createProjectNoteFiles, createProjectAssetWriter } from "./projectNoteFiles";
export { createRecentSendTargetsStore } from "./recentSendTargets";
