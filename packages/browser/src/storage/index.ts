// Exports the browser storage layer's public API.
export { createLibraryFileSystem, readLibraryLocation, readLibraryLocations, refreshFromFiles, onLibraryFilesChanged, onPaperRecordsRebuilt, type LibraryLocation, type LibraryLocations } from "./libraryFileSystem";
export { cachePaperRecords, createLibraryMutationContext, createLibraryMutations, type LibraryMutations } from "./libraryMutations";
export { readCachedPaperRecord, listCachedPaperRecords, movePaperNotes, buildFolderTree, scanLibrary, listPdfDirs, readCurrentLibraryId, createSidecarPort, createPaperNotesPort, createReaderThemesPort, createEditorPrefsPort, createBrowserProjects, type BrowserProjects } from "./records";
export { createIdbHistoryStorage } from "./idb";
export { writeStagedPdf, readStagedPdf, removeStagedPdf, removeStagedPdfsExcept } from "./staging";
export { createBrowserDeviceIdentity, removeBrowserCollabDocs, openBrowserCollabStorage } from "./collab";
export { openTabLease, updateTabLease, createTabLeaseName, watchTabLease, type TabLease } from "./tabLease";
export { createProjectNoteFiles, createProjectAssetWriter } from "./projectNoteFiles";
export { createBrowserNoteFileIo } from "./noteFiles";
export { createRecentSendTargetsStore } from "./recentSendTargets";
export { browserDictionaryStore } from "./dictionaries";
