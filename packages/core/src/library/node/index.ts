/** Exports the library's Node file-system adapters for the core ports. */
export { writeFileAtomic } from "./atomicWrite.js";
export { readOptionalFile } from "./readOptionalFile.js";
export { cacheDir } from "./cacheDirectory.js";
export { resolveConflictCopy } from "../conflicts/node/index.js";
export { deviceLocalLayout, libraryKey, stateDir, type DeviceLocalLayout } from "./deviceState/index.js";
export { NodeLibraryFileSystem } from "./nodeLibraryFileSystem.js";
export {
  loadSharedConfig, readSharedLibraryRoot, sharedConfigDir, sharedConfigPath, updateSharedConfig,
} from "./sharedConfigFile.js";
export {
  detectSyncFolders, inspectLibraryFolder, moveLibrary,
  type DetectSyncFoldersOptions, type LibraryFolderInfo, type MoveLibraryOptions, type SyncFolder, type SyncFolderTool,
} from "./location/index.js";
