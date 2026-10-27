/** Exports the encrypted peer mesh a share session runs its channels over, the wire format of its messages, and the presence shared over it. */
export { createSecureMesh } from "./peerMesh.js";
export {
  ACK_DELAY_MS, CHANNEL_KIND, createDocIdCache, decodeEnvelope, deriveDocId, DOC_ID_BYTES, encodeEnvelope, ENVELOPE_HEADER_BYTES,
  ENVELOPE_VERSION, EXTENSION_KIND_MIN, MAX_SEND_ATTEMPTS, MESSAGE_KIND, openDocFrame, RESEND_AFTER_MS, sealDocFrame, startInterval,
  systemScheduler,
} from "./channel.js";
export type { Channel, ChannelSpec, Envelope, EnvelopeResult, PeerMesh, SessionPhase, SessionScheduler } from "./channel.js";
export { attachPresence, isPeerPresence } from "./presence.js";
export type { PresenceOptions, PresenceState, PresenceStore, RelayReport } from "./presence.js";
