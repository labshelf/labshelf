/** Exports the library location: where the library root is stored and how a fresh one is set up. */
export {
  ensureLibraryStructure,
  mirrorLibraryRoot,
  resolveLibraryRoot,
  runLibrarySetupWizard,
} from "./libraryLocation.js";
export type { SharedLibraryConfig } from "./sharedLibraryConfig.js";
