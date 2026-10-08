/**
 * Public API of the browser storage layer.
 */
export { IndexedDbFileSystem } from "./indexedDbFileSystem";
export { IdbManifestFileSystem } from "./idbManifestFileSystem";
export { createLibraryMutations } from "./libraryMutations";
export type { LibraryMutations } from "./libraryMutations";
export {
  upsertRecord,
  deleteRecord,
  getRecord,
  listAllRecords,
  rebuildFromFiles,
} from "./paperRecordStore";
export { buildFolderTree, scanLibrary, pdfDirs } from "./folderTreeStore";
export { getDb } from "./idb";
export type { FileRow, MetadataRow, ManifestRow, LabShelfSchema } from "./idb";
