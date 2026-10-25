/** Exports the encrypted peer mesh a share session runs its channels over, and the wire format of its messages. */
export { createSecureMesh } from "./peerMesh.js";
export type { Channel, ChannelSpec, PeerMesh, SessionPhase } from "./channel.js";
export { ACK_DELAY_MS, MAX_SEND_ATTEMPTS, RESEND_AFTER_MS } from "./reliableChannel.js";
export { startInterval, systemScheduler, type SessionScheduler } from "./scheduler.js";
export {
  CHANNEL_KIND, decodeEnvelope, DOC_ID_BYTES, encodeEnvelope, ENVELOPE_HEADER_BYTES, EXTENSION_KIND_MIN, MESSAGE_KIND, ENVELOPE_VERSION,
  type Envelope, type EnvelopeResult,
} from "./envelope.js";
export { deriveDocId } from "./docId.js";
export { createDocIdCache, openDocFrame, sealDocFrame } from "./docMessage.js";
