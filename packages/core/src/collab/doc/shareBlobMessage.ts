// Encodes and decodes the messages of the blob channel: a request, a chunk of the answer and a refusal.

// CONTRACT: documents/contracts/collaboration.md#messages
export const BLOB_CHUNK_BYTES = 64 * 1024;
export const MAX_BLOB_BYTES = 256 * 1024 * 1024;
const MAX_BLOB_CHUNKS = MAX_BLOB_BYTES / BLOB_CHUNK_BYTES;
const CHUNK_HEADER_BYTES = 9;

const TYPE = { request: 1, chunk: 2, missing: 3 } as const;

export type ShareBlobMessage =
  | { type: "request" }
  | { type: "missing" }
  | { type: "chunk"; index: number; total: number; bytes: Uint8Array };

export const encodeShareBlobRequest = (): Uint8Array => new Uint8Array([TYPE.request]);
export const encodeShareBlobMissing = (): Uint8Array => new Uint8Array([TYPE.missing]);

/** type (1) | chunk index, big-endian (4) | chunk count, big-endian (4) | bytes. */
export function encodeShareBlobChunk(index: number, total: number, bytes: Uint8Array): Uint8Array {
  const message = new Uint8Array(CHUNK_HEADER_BYTES + bytes.length);
  const view = new DataView(message.buffer);
  message[0] = TYPE.chunk;
  view.setUint32(1, index);
  view.setUint32(5, total);
  message.set(bytes, CHUNK_HEADER_BYTES);
  return message;
}

/** The chunks of a blob; an empty blob is one empty chunk. */
export function splitShareBlob(blob: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let start = 0; start < blob.length || chunks.length === 0; start += BLOB_CHUNK_BYTES) {
    chunks.push(blob.subarray(start, start + BLOB_CHUNK_BYTES));
  }
  return chunks;
}

/** Undefined for a message that is malformed or announces more than a blob may hold; peers are untrusted. */
export function decodeShareBlobMessage(payload: Uint8Array): ShareBlobMessage | undefined {
  if (payload[0] === TYPE.request && payload.length === 1) { return { type: "request" }; }
  if (payload[0] === TYPE.missing && payload.length === 1) { return { type: "missing" }; }
  if (payload[0] !== TYPE.chunk || payload.length < CHUNK_HEADER_BYTES) { return undefined; }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const index = view.getUint32(1);
  const total = view.getUint32(5);
  const bytes = payload.subarray(CHUNK_HEADER_BYTES);
  if (total < 1 || total > MAX_BLOB_CHUNKS || index >= total || bytes.length > BLOB_CHUNK_BYTES) { return undefined; }
  return { type: "chunk", index, total, bytes };
}
