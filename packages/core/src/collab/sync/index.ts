/** Exports the share session that syncs a share's docs over a peer transport, and the wire format it speaks. */
export { createShareSession, type ShareSession, type ShareSessionOptions } from "./shareSession.js";
export { INDEX_DOC_KEY } from "./docSync.js";
export {
  ACK_DELAY_MS, MAX_MESH_PEERS, MAX_SEND_ATTEMPTS, RESEND_AFTER_MS, systemScheduler,
  type Channel, type ChannelSpec, type SessionScheduler, type SessionStatus,
} from "./mesh/index.js";
export {
  CHANNEL_KIND, decodeEnvelope, deriveDocId, DOC_ID_BYTES, encodeEnvelope, ENVELOPE_HEADER_BYTES, EXTENSION_KIND_MIN, MESSAGE_KIND, ENVELOPE_VERSION,
  type Envelope, type EnvelopeResult,
} from "./wire/index.js";
export {
  attachAwareness, isPresenceState, type AwarenessOptions, type PresenceHandle, type PresenceState,
} from "./awareness/index.js";
export {
  attachBlobs, BLOB_CHUNK_BYTES, BlobFetchError, MAX_BLOB_BYTES, type BlobExchange, type BlobFetchErrorCode, type BlobsOptions,
} from "./blobs/index.js";
