// Digests secrets with SHA-256, so the relay stores only hashes and compares secrets in constant time.

import { bytesToHex } from "../../../encoding/index.js";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)));
}

/** Compares equal-length digests, so the time taken says nothing about where the texts differ. */
export async function secretsMatch(given: string, expected: string): Promise<boolean> {
  const encode = (text: string) => new TextEncoder().encode(text);
  const [a, b] = await Promise.all([sha256Hex(encode(given)), sha256Hex(encode(expected))]);
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) { difference |= a.charCodeAt(index) ^ b.charCodeAt(index); }
  return difference === 0;
}
