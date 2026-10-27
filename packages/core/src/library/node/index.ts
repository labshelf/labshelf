/** Exports the library's Node file-system adapters for the core ports. */
export { writeFileAtomic, writeSyncedFile } from "./atomicWrite.js";
export { ensurePrivateDir, isGroupOrOtherWritable, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "./privateDir.js";
export { readOptionalFile } from "./readOptionalFile.js";
export { resolveCacheDir } from "./resolveCacheDir.js";
export { createDeviceIdentity, createDeviceLocalLayout, deriveLibraryKey, resolveDeviceStateDir, type DeviceLocalLayout } from "./layout.js";
export { NodeLibraryFileSystem } from "./nodeLibraryFileSystem.js";
export {
  loadSharedConfig, readSharedLibraryRoot, resolveSharedConfigDir, resolveSharedConfigPath, updateSharedConfig,
} from "./sharedConfigFile.js";
export {
  countPaperFolders, detectSyncFolders, detectLibraryFolder, formatPath, LIBRARY_FOLDER_NAME, listLibraryFolders, moveLibrary, resolveLibraryDir, formatSyncTool,
  type DetectSyncFoldersOptions, type LibraryFolderChoice, type LibraryFolderDetails, type MoveLibraryOptions, type SyncFolder, type SyncFolderTool,
} from "./libraryLocation/index.js";
export { resolveConflictCopy, resolveConflictDismissalFile, findProjectConflict, resolveProjectConflictCopy, type ProjectConflictResolutionContext } from '../conflicts/node/index.js';
