/** Exports the share session that keeps a share's docs in step with its peers, and the exchange of binary files between them. */
export { createShareSession, type ShareSession, type ShareSessionOptions } from "./shareSession.js";
export { INDEX_DOC_KEY } from "./docSync.js";
export { attachShareBlobs, type ShareBlobExchange, type ShareBlobsOptions } from "./attachShareBlobs.js";
export { ShareBlobFetchError, type ShareBlobFetchErrorCode } from "./ShareBlobFetchError.js";
export { BLOB_CHUNK_BYTES, MAX_BLOB_BYTES } from "./shareBlobMessage.js";
