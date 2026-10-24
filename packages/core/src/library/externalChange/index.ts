/** Exports the external-change detection helpers' public API. */
export { isExternalChangeNoise } from "./noiseFilter.js";
export { processChangeBatch, type ChangeBatchDeps } from "./changeBatch.js";
export { RootPresenceMonitor, type RootPresenceDeps } from "./libraryRootPresence.js";
