// Exports the Drive folder naming API.
// It covers the paperId ↔ title maps and the per-run remote folder namer.
export { buildLibraryFolderNames, driveFolderName } from "./folderNames.js";
export { createLibraryFolderNamer, isSafeFolderName } from "./libraryFolderNamer.js";
export type { LibraryFolderNamerDeps } from "./libraryFolderNamer.js";
