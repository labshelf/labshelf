// Exports the browser storage layer's public API.
export { IndexedDbFileSystem } from "./indexedDbFileSystem";
export { IdbManifestFileSystem } from "./idbManifestFileSystem";
export { createIdbSidecarPort } from "./idbSidecarPort";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  upsertRecord,
  getRecord,
  listAllRecords,
  rebuildFromFiles,
} from "./paperRecordStore";
export { buildFolderTree, scanLibrary, pdfDirs } from "./folderTreeStore";
