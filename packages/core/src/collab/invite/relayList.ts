// Encodes the relay list an invite carries and validates it when decoding untrusted text.
import { base64UrlToBytes, bytesToBase64Url } from "../../encoding/index.js";

export interface InviteRelay {
  url: string;
  relayToken?: string;
}

export function encodeRelayList(relays: InviteRelay[]): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(relays)));
}

function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

function toRelay(value: unknown): InviteRelay | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) { return undefined; }
  const { url, relayToken, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof url !== "string" || !isHttpsUrl(url)) { return undefined; }
  if (relayToken === undefined) { return { url }; }
  return typeof relayToken === "string" ? { url, relayToken } : undefined;
}

/** Returns undefined for anything but a JSON array of https relays with known fields. */
export function decodeRelayList(text: string): InviteRelay[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(base64UrlToBytes(text)));
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) { return undefined; }
  const relays = parsed.map(toRelay);
  return relays.every((relay) => relay !== undefined) ? (relays as InviteRelay[]) : undefined;
}
