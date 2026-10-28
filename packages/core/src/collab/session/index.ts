/** Exports the connection of this device to a shared project: its stored state, relays, blobs and disk mirror, opened and closed in one order, and the registry of the shares a window or page has open. */
export {
  connectShare, createLeasedMirrorFactory, startShareRelays,
  type ConnectionMirror, type LeasedMirrorOptions, type MirrorFactory, type MirrorInput, type MirrorStart, type MirrorState,
  type RelayNetwork, type ShareConnection, type ShareConnectionOptions, type ShareConnectionState, type ShareRelays, type ShareRelayState,
} from "./shareConnection.js";
export {
  applyRestoredFiles, ensureSharedProject, ensureShareIndexDocReady, UnknownShareKindError,
  type ApplyRestoredFilesOptions, type PlacedProject, type ShareProjects, type ShareStart,
} from "./sharedProject.js";
export {
  loadVersionHistory, openCollabStore, ShareBlobCache, StoredMap, VERSIONS_PER_PATH,
  type CollabDeviceStateStorage, type CollabStore, type CollabStoreOptions, type DeviceStateMapName, type StoredDoc, type StoredVersion,
} from "./collabStore.js";
export { createShareRegistry, type ShareCloseFailure, type OpenShareRegistry, type OpenShareRegistryOptions } from "./shareRegistry.js";
