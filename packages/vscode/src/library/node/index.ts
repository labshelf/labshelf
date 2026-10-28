// Exports the library-location flows that need Node: the shared config file, the first-run question over detected sync folders and moving the library.
export { nodeSharedLibraryConfig, pickLibraryRoot } from "./sharedLibraryConfig.js";
export { offerLibraryMove, runMoveLibraryCommand } from "./moveLibrary.js";
