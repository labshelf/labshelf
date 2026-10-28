// Compares, joins and randomly fills byte arrays.
import { bytesToHex } from "./hex.js";

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

export function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

/** Fills `bytes` from the platform's cryptographic random source and returns them. */
export function fillRandom(bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(bytes);
}

/** Gives `byteCount` random bytes as lower-case hex; `fill` is injectable for tests. */
export function randomHex(byteCount = 4, fill: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer> = fillRandom): string {
  return bytesToHex(fill(new Uint8Array(byteCount)));
}
