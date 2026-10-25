// Exports library location helpers: sync folder detection, folder inspection and library moves.
export { countPaperFolders } from "./countPaperFolders.js";
export { detectSyncFolders, type DetectSyncFoldersOptions, type SyncFolder, type SyncFolderTool } from "./detectSyncFolders.js";
export { detectLibraryFolder, type LibraryFolderDetails } from "./detectLibraryFolder.js";
export { moveLibrary, type MoveLibraryOptions } from "./moveLibrary.js";
