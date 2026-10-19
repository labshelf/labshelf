// Encodes and decodes the clear header every share message travels under, ahead of its encrypted frame.

// CONTRACT: documents/contracts/collaboration.md#messages
export const ENVELOPE_VERSION = 3;

export const MESSAGE_KIND = { syncStep1: 1, syncStep2: 2, update: 3, ack: 4 } as const;

/** Kinds from here to 255 belong to channels layered on a session, such as awareness and blobs. */
export const EXTENSION_KIND_MIN = 16;

// CONTRACT: documents/contracts/collaboration.md#messages
export const CHANNEL_KIND = { awareness: EXTENSION_KIND_MIN, blob: EXTENSION_KIND_MIN + 1 } as const;

export const DOC_ID_BYTES = 16;

/** version (1) | kind (1) | epoch, big-endian (8) | sequence, big-endian (4) | doc id (16). */
export const ENVELOPE_HEADER_BYTES = 14 + DOC_ID_BYTES;

export interface Envelope {
  kind: number;
  /** The sender's link to this peer, higher for each link it opens; 0 on a message that is never acked or resent. */
  epoch: bigint;
  /** Per-link sequence number of a reliable message; 0 marks a message that is never acked or resent. */
  seq: number;
  docId: Uint8Array;
  frame: Uint8Array;
}

export type EnvelopeResult = { ok: true; envelope: Envelope } | { ok: false; error: "tooShort" | "badVersion" };

export function encodeEnvelope({ kind, epoch, seq, docId, frame }: Envelope): Uint8Array {
  const bytes = new Uint8Array(ENVELOPE_HEADER_BYTES + frame.length);
  bytes[0] = ENVELOPE_VERSION;
  bytes[1] = kind;
  const view = new DataView(bytes.buffer);
  view.setBigUint64(2, epoch);
  view.setUint32(10, seq);
  bytes.set(docId, 14);
  bytes.set(frame, ENVELOPE_HEADER_BYTES);
  return bytes;
}

/** Never throws on hostile input: every failure is a typed result. */
export function decodeEnvelope(bytes: Uint8Array): EnvelopeResult {
  if (bytes.length < ENVELOPE_HEADER_BYTES) { return { ok: false, error: "tooShort" }; }
  if (bytes[0] !== ENVELOPE_VERSION) { return { ok: false, error: "badVersion" }; }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = { kind: bytes[1]!, epoch: view.getBigUint64(2), seq: view.getUint32(10) };
  return {
    ok: true,
    envelope: { ...header, docId: bytes.slice(14, ENVELOPE_HEADER_BYTES), frame: bytes.slice(ENVELOPE_HEADER_BYTES) },
  };
}
