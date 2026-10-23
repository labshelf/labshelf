/** Exports the library's Node file-system adapters for the core ports. */
export { writeFileAtomic, writeSyncedFile } from "./atomicWrite.js";
export { ensurePrivateDir, isGroupOrOtherWritable, PRIVATE_DIR_MODE, PRIVATE_FILE_MODE } from "./privateDir.js";
export { readOptionalFile } from "./readOptionalFile.js";
export { cacheDir } from "./cacheDirectory.js";
export { createDeviceIdentity, deviceLocalLayout, libraryKey, stateDir, type DeviceLocalLayout } from "./deviceState/index.js";
export { NodeLibraryFileSystem } from "./nodeLibraryFileSystem.js";
export {
  loadSharedConfig, readSharedLibraryRoot, sharedConfigDir, sharedConfigPath, updateSharedConfig,
} from "./sharedConfigFile.js";
export {
  countPaperFolders, detectSyncFolders, inspectLibraryFolder, moveLibrary,
  type DetectSyncFoldersOptions, type LibraryFolderInfo, type MoveLibraryOptions, type SyncFolder, type SyncFolderTool,
} from "./location/index.js";
export { resolveConflictCopy, conflictDismissalFile, findProjectConflict, resolveProjectConflictCopy, type ProjectConflictResolutionContext } from '../conflicts/node/index.js';
