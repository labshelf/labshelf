/** Exports the connection of this device to a shared project: its stored state, relays, blobs and disk mirror, opened and closed in one order. */
export type { ConnectionMirror, MirrorFactory, MirrorInput, MirrorStart, MirrorState } from "./connectionMirror.js";
export { createLeasedMirrorFactory, type LeasedMirrorOptions } from "./leasedMirror.js";
export { ensureSharedProject, type PlacedProject, type ShareProjects, type ShareStart } from "./ensureSharedProject.js";
export { ensureShareIndexDocReady, UnknownShareKindError } from "./shareIndexDocReady.js";
export { connectShare, type ShareConnection, type ShareConnectionOptions, type ShareConnectionState } from "./shareConnection.js";
export { startShareRelays, type RelayNetwork, type ShareRelays, type ShareRelayState } from "./shareRelays.js";
export { applyRestoredFiles, type ApplyRestoredFilesOptions } from "./applyRestoredFiles.js";
