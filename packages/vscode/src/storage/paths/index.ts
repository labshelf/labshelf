/** Exports the library location: where the library root is stored (the shared config, or global state on the web) and how its folders are created. */
export {
  ensureLibraryStructure,
  resolveLibraryRoot,
} from "./libraryLocation.js";
export type { SharedLibraryConfig } from "./sharedLibraryConfig.js";
export { globalStateLibraryConfig } from "./globalStateLibraryConfig.js";
