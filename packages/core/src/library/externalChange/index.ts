/** Exports the external-change detection helpers' public API. */
export { isExternalChangeNoise } from "./noiseFilter.js";
export { applyChangeBatch, type ChangeBatchDeps } from "./changeBatch.js";
export { LibraryRootPresenceMonitor, type LibraryRootPresenceDeps } from "./libraryRootPresence.js";
