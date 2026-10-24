/** Exports the device-local state of a share behind a storage port: its stored docs, blob cache, known file hashes and relay cursors with the state each relay holds. */
export { BlobCache } from "./blobCache.js";
export { openCollabStore, type CollabStore, type CollabStoreOptions } from "./collabStore.js";
export type { CollabStateStorage, StateMapName, StoredDoc } from "./collabStorage.js";
export { PersistedMap } from "./storedMap.js";
export { loadVersionHistory, VERSIONS_PER_PATH, type StoredVersion } from "./versionHistory.js";
