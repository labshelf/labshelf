/** Exports the connection of this device to a shared project: its stored state, relays, blobs and disk mirror, opened and closed in one order. */
export type { ConnectionMirror, MirrorFactory, MirrorInput, MirrorStart, MirrorState } from "./connectionMirror.js";
export { leasedMirrorFactory, type LeasedMirrorOptions } from "./leasedMirror.js";
export { placeSharedProject, type PlacedProject, type ShareProjects, type ShareStart } from "./placeSharedProject.js";
export { projectIndexReady, UnknownShareKindError } from "./projectIndexReady.js";
export { connectShare, type ShareConnection, type ShareConnectionOptions, type ShareConnectionState } from "./shareConnection.js";
export { followShareRelays, type RelayNetwork, type ShareRelays, type ShareRelayState } from "./shareRelays.js";
