/** Exports the Node side of versions: marking a snapshot, listing the snapshots a project holds and building a marked-up PDF between two of them. */
export { markVersion } from "./markVersion.js";
export { listVersions } from "./listVersions.js";
export { buildMarkedUpDiff } from "./buildMarkedUpDiff.js";
export type { MarkedUpDiffRequest } from "./buildMarkedUpDiff.js";
