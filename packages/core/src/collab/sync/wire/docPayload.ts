// Encodes the plaintext of a doc message: the real doc key, then the payload.

// CONTRACT: documents/contracts/collaboration.md#messages
export function encodeDocPayload(docKey: string, payload: Uint8Array): Uint8Array {
  const key = new TextEncoder().encode(docKey);
  if (key.length > 0xffff) { throw new Error(`Doc key of ${key.length} bytes exceeds the 65535-byte limit`); }
  const bytes = new Uint8Array(2 + key.length + payload.length);
  new DataView(bytes.buffer).setUint16(0, key.length);
  bytes.set(key, 2);
  bytes.set(payload, 2 + key.length);
  return bytes;
}

/** Undefined for bytes too short for the key length they announce. */
export function decodeDocPayload(bytes: Uint8Array): { docKey: string; payload: Uint8Array } | undefined {
  if (bytes.length < 2) { return undefined; }
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0);
  if (bytes.length < 2 + length) { return undefined; }
  return { docKey: new TextDecoder().decode(bytes.subarray(2, 2 + length)), payload: bytes.subarray(2 + length) };
}
