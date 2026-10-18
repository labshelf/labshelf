// Encodes and decodes the clear header every share message travels under, ahead of its encrypted frame.

// CONTRACT: documents/contracts/collaboration.md#messages
export const ENVELOPE_VERSION = 1;

export const MESSAGE_KIND = { syncStep1: 1, syncStep2: 2, update: 3, ack: 4 } as const;

/** Kinds from here to 255 belong to channels layered on a session, such as awareness and blobs. */
export const EXTENSION_KIND_MIN = 16;

// CONTRACT: documents/contracts/collaboration.md#messages
export const CHANNEL_KIND = { awareness: EXTENSION_KIND_MIN, blob: EXTENSION_KIND_MIN + 1 } as const;

export const DOC_ID_BYTES = 16;

/** version (1) | kind (1) | sequence, big-endian (4) | doc id (16). */
export const ENVELOPE_HEADER_BYTES = 6 + DOC_ID_BYTES;

export interface Envelope {
  kind: number;
  /** Per-peer sequence number of a reliable message; 0 marks a message that is never acked or resent. */
  seq: number;
  docId: Uint8Array;
  frame: Uint8Array;
}

export type EnvelopeResult = { ok: true; envelope: Envelope } | { ok: false; error: "tooShort" | "badVersion" };

export function encodeEnvelope({ kind, seq, docId, frame }: Envelope): Uint8Array {
  const bytes = new Uint8Array(ENVELOPE_HEADER_BYTES + frame.length);
  bytes[0] = ENVELOPE_VERSION;
  bytes[1] = kind;
  new DataView(bytes.buffer).setUint32(2, seq);
  bytes.set(docId, 6);
  bytes.set(frame, ENVELOPE_HEADER_BYTES);
  return bytes;
}

/** Never throws on hostile input: every failure is a typed result. */
export function decodeEnvelope(bytes: Uint8Array): EnvelopeResult {
  if (bytes.length < ENVELOPE_HEADER_BYTES) { return { ok: false, error: "tooShort" }; }
  if (bytes[0] !== ENVELOPE_VERSION) { return { ok: false, error: "badVersion" }; }
  const seq = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(2);
  return {
    ok: true,
    envelope: { kind: bytes[1]!, seq, docId: bytes.slice(6, ENVELOPE_HEADER_BYTES), frame: bytes.slice(ENVELOPE_HEADER_BYTES) },
  };
}
