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
