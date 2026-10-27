/** Converts bytes to and from canonical unpadded base64url, the URL-safe alphabet of RFC 4648 §5. */
import { base64ToBytes, bytesToBase64 } from "./base64.js";

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/** Throws when `text` is not canonical unpadded base64url. */
export function base64UrlToBytes(text: string): Uint8Array {
  if (/[+/=]/.test(text)) { throw new Error(`Not base64url (${text.length} characters)`); }
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  return base64ToBytes(padded);
}

/** Gives the key bytes only when `text` is canonical base64url of exactly `length` bytes; never throws. */
export function decodeKeyBytes(text: string, length: number): Uint8Array | undefined {
  try {
    const bytes = base64UrlToBytes(text);
    return bytes.length === length ? bytes : undefined;
  } catch {
    // TRAP: 22 base64url characters hold 132 bits, so a last character with stray low bits is not canonical and throws.
    return undefined;
  }
}
