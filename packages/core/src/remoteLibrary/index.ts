/** The runtime-neutral surface of the remote library mirror. */
// TRAP: collab already exports a MirrorState from the core root, so the table's type leaves here as RemoteMirrorState.
export {
  parseMirrorState, serializeMirrorState, stateForMirror,
  type MirrorKind, type MirrorRow, type MirrorState as RemoteMirrorState, type MirrorStateStore,
} from "./mirrorState.js";
export { createMirrorRelay, MirrorRefusal } from "./mirrorRelay.js";
export type { MirrorEdit, MirrorPut, MirrorRelay, MirrorSettings, MirrorStatus, MirrorStore } from "./mirrorRelay.js";
export { applyMirrorEdits } from "./mirrorEdits.js";
export type { MirrorEditFiles, MirrorEditsDeps, MirrorEditsResult } from "./mirrorEdits.js";
export { createMirrorRunner } from "./mirrorRunner.js";
export type { MirrorRunnerDeps, MirrorRunResult, MirrorStorage } from "./mirrorRunner.js";
export { createRemoteAccess } from "./remoteAccess.js";
export type { RemoteAccess, RemoteAccessDeps, RemoteAccessResult } from "./remoteAccess.js";
export { createAccountRemote, mergeRemoteDetails } from "./accountRemote.js";
export type { AccountRemoteDeps } from "./accountRemote.js";
export { readCloudflareEmail } from "./cloudflareEmail.js";
export { estimatePaperPdfs, MAX_MIRROR_FILE_BYTES, selectMirrorFiles } from "./mirrorSelection.js";
export type { MirrorFile, MirrorPaper, MirrorSelection, MirrorSelectionDeps } from "./mirrorSelection.js";
