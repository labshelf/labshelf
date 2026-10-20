/** Exports the device-local state of a share behind a storage port: its stored docs, blob cache, known file hashes and relay cursors. */
export { BlobCache } from "./blobCache.js";
export { openCollabStore, type CollabStore, type CollabStoreOptions } from "./collabStore.js";
export type { CollabStateStorage, StateMapName, StoredDoc } from "./collabStateStorage.js";
export { PersistedMap } from "./persistedMap.js";
