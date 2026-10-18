/** Converts bytes to and from canonical padded base64 on any runtime that has btoa and atob. */

// PLATFORM: String.fromCharCode spreads its arguments on the stack, so large buffers convert in slices.
const CHARS_PER_CALL = 0x8000;

// Padded, standard alphabet, and the bits a pad hides are zero, so every byte string has exactly one encoding.
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/][AQgw]==|[A-Za-z0-9+/]{2}[AEIMQUYcgkosw048]=)?$/;

export function isCanonicalBase64(text: string): boolean {
  return CANONICAL_BASE64.test(text);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHARS_PER_CALL) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHARS_PER_CALL));
  }
  return btoa(binary);
}

/** Throws when `text` is not canonical padded base64; atob alone accepts unpadded and non-zero pad bits. */
export function base64ToBytes(text: string): Uint8Array {
  if (!isCanonicalBase64(text)) { throw new Error(`Not canonical base64 (${text.length} characters)`); }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) { bytes[i] = binary.charCodeAt(i); }
  return bytes;
}
