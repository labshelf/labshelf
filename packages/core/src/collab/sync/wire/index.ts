/** Exports the wire format of share messages: the clear envelope and the opaque doc id. */
export {
  CHANNEL_KIND, decodeEnvelope, DOC_ID_BYTES, encodeEnvelope, ENVELOPE_HEADER_BYTES, EXTENSION_KIND_MIN, MESSAGE_KIND, ENVELOPE_VERSION,
  type Envelope, type EnvelopeResult,
} from "./envelope.js";
export { deriveDocId } from "./docId.js";
export { docIdCache, openDocFrame, sealDocFrame } from "./docMessage.js";
