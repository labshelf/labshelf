// Exports library location helpers: sync folder detection and naming, folder inspection, display paths and library moves.
export { countPaperFolders } from "./countPaperFolders.js";
export { detectSyncFolders, type DetectSyncFoldersOptions, type SyncFolder, type SyncFolderTool } from "./detectSyncFolders.js";
export { detectLibraryFolder, type LibraryFolderDetails } from "./detectLibraryFolder.js";
export { moveLibrary, type MoveLibraryOptions } from "./moveLibrary.js";
export { formatPath } from "./formatPath.js";
export { LIBRARY_FOLDER_NAME, resolveLibraryDir } from "./resolveLibraryDir.js";
export { formatSyncTool } from "./formatSyncTool.js";
export { listLibraryFolders, type LibraryFolderChoice } from "./listLibraryFolders.js";
