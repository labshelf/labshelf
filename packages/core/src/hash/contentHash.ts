// Computes the SHA-256 hex digest of file content.
// PLATFORM: uses Web Crypto so the same routine runs under Node 20+ and browser extension contexts.

const HEX = "0123456789abcdef";

/** Returns the lowercase hex SHA-256 digest of the given bytes. */
export async function deriveSha256Hex(content: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", content as Uint8Array<ArrayBuffer>);
  const view = new Uint8Array(buffer);
  let out = "";
  for (const byte of view) {
    out += HEX[(byte >> 4) & 0x0f]! + HEX[byte & 0x0f]!;
  }
  return out;
}
