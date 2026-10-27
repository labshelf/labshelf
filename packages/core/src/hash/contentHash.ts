// Computes the SHA-256 hex digest of bytes or text.
// PLATFORM: uses Web Crypto so the same routine runs under Node 20+ and browser extension contexts.
import { bytesToHex } from "../encoding/index.js";

/** Returns the lowercase hex SHA-256 digest of the given bytes. */
export async function deriveSha256Hex(content: Uint8Array): Promise<string> {
  const buffer = await crypto.subtle.digest("SHA-256", content as Uint8Array<ArrayBuffer>);
  return bytesToHex(new Uint8Array(buffer));
}

/** Returns the lowercase hex SHA-256 digest of the text's UTF-8 bytes, or of the bytes as given. */
export function deriveTextSha256Hex(content: string | Uint8Array): Promise<string> {
  return deriveSha256Hex(typeof content === "string" ? new TextEncoder().encode(content) : content);
}
