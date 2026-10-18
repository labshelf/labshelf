// Mints and checks the short-lived HMAC tickets that open a share's socket.

import { base64UrlToBytes, bytesToBase64Url } from "../../../encoding/index.js";

const TICKET_SECONDS = 300;
const TICKET_PATTERN = /^([1-9]\d{0,11})\.([A-Za-z0-9_-]{43})$/;

// CONTRACT: documents/contracts/relay.md#auth
async function ticketKey(ownerSecret: string) {
  const secret = await crypto.subtle.importKey("raw", new TextEncoder().encode(ownerSecret), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: new TextEncoder().encode("ticket") },
    secret,
    { name: "HMAC", hash: "SHA-256", length: 256 },
    false,
    ["sign", "verify"],
  );
}

const signedText = (shareId: string, expires: number) => new TextEncoder().encode(`${shareId}|${expires}`);

export async function mintTicket(ownerSecret: string, shareId: string, nowSeconds: number): Promise<{ ticket: string; expires: number }> {
  const expires = nowSeconds + TICKET_SECONDS;
  const mac = await crypto.subtle.sign("HMAC", await ticketKey(ownerSecret), signedText(shareId, expires));
  return { ticket: `${expires}.${bytesToBase64Url(new Uint8Array(mac))}`, expires };
}

/** False for a malformed, forged, expired or other share's ticket; HMAC verify compares in constant time. */
export async function verifyTicket(ownerSecret: string, shareId: string, ticket: string, nowSeconds: number): Promise<boolean> {
  const match = TICKET_PATTERN.exec(ticket);
  if (!match || Number(match[1]) <= nowSeconds) { return false; }
  let mac: Uint8Array;
  try { mac = base64UrlToBytes(match[2]!); } catch { return false; }
  return crypto.subtle.verify("HMAC", await ticketKey(ownerSecret), mac as Uint8Array<ArrayBuffer>, signedText(shareId, Number(match[1])));
}
