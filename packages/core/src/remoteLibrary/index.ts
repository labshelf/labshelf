/** The runtime-neutral surface of the remote library mirror. */
// TRAP: collab already exports a MirrorState from the core root, so the table's type leaves here as RemoteMirrorState.
export {
  parseMirrorState, serializeMirrorState, stateForRelay,
  type MirrorRow, type MirrorState as RemoteMirrorState, type MirrorStateStore,
} from "./mirrorState.js";
export { createMirrorRelay } from "./mirrorRelay.js";
export type { MirrorPut, MirrorRelay } from "./mirrorRelay.js";
export { createMirrorRunner } from "./mirrorRunner.js";
export type { MirrorRunResult } from "./mirrorRunner.js";
export { selectMirrorFiles } from "./mirrorSelection.js";
export type { MirrorFile, MirrorPaper, MirrorSelection, MirrorSelectionDeps } from "./mirrorSelection.js";
