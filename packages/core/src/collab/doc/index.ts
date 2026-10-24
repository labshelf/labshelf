/** Exports the share session that keeps a share's docs in step with its peers, and the exchange of binary files between them. */
export { createShareSession, type ShareSession, type ShareSessionOptions } from "./shareSession.js";
export { INDEX_DOC_KEY } from "./docSync.js";
export { attachBlobs, type BlobExchange, type BlobsOptions } from "./attachBlobs.js";
export { BlobFetchError, type BlobFetchErrorCode } from "./blobFetchError.js";
export { BLOB_CHUNK_BYTES, MAX_BLOB_BYTES } from "./blobMessage.js";
