/** Exports the library's Node file-system adapters for the core ports. */
export {
  ensurePrivateDir, isGroupOrOtherWritable, NodeLibraryFileSystem, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE, readOptionalFile, writeFileAtomic, writeSyncedFile,
} from "./fileSystem.js";
export {
  createDeviceIdentity, createDeviceLocalLayout, deriveLibraryKey, loadSharedConfig, readSharedLibraryRoot, resolveCacheDir, resolveDeviceStateDir,
  resolveSharedConfigDir, resolveSharedConfigPath, updateSharedConfig, type DeviceLocalLayout,
} from "./layout.js";
export {
  countPaperFolders, detectLibraryFolder, formatPath, LIBRARY_FOLDER_NAME, listLibraryFolders, moveLibrary, resolveLibraryDir,
  type LibraryFolderChoice, type LibraryFolderDetails, type MoveLibraryOptions,
} from "./location.js";
export { detectSyncFolders, formatSyncTool, type DetectSyncFoldersOptions, type SyncFolder, type SyncFolderTool } from "./syncFolders.js";
export { resolveConflictCopy, resolveConflictDismissalFile, findProjectConflict, resolveProjectConflictCopy, type ProjectConflictResolutionContext } from '../conflicts/node/index.js';
