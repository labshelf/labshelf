// Writes and parses share links, whose fragment carries the Worker host, the share id and the link key.
import { base64UrlToBytes, bytesToBase64Url } from "../encoding/index.js";
import { isShareId } from "../relay/index.js";

// CONTRACT: documents/contracts/share-link.md#link
export const SHARE_PAGE_ORIGIN = "https://labshelf.org";
export const SHARE_LINK_KEY_BYTES = 16;

export interface ShareLinkParts {
  /** `https://<worker host>`, the Worker that serves the share. */
  relayUrl: string;
  shareId: string;
  key: Uint8Array;
}

export type ShareLinkError = "notShareLink" | "badHost" | "badShareId" | "badKey";
export type ShareLinkResult = { ok: true; link: ShareLinkParts } | { ok: false; error: ShareLinkError };

const HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const KEY = /^[A-Za-z0-9_-]{22}$/;

export function formatShareLink({ relayUrl, shareId, key }: ShareLinkParts): string {
  return `${SHARE_PAGE_ORIGIN}/share/#${new URL(relayUrl).hostname}/${shareId}/${bytesToBase64Url(key)}`;
}

/** Never throws: any text that is not a well-formed share link is a typed error. */
export function parseShareLink(text: string): ShareLinkResult {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, error: "notShareLink" };
  }
  // PLATFORM: VS Code's Uri encodes a fragment's slashes as %2F when it hands a link to the browser; no valid part holds a %.
  let fragment: string;
  try {
    fragment = decodeURIComponent(url.hash.slice(1));
  } catch {
    return { ok: false, error: "notShareLink" };
  }
  const parts = fragment.split("/");
  if (!url.pathname.endsWith("/share/") || parts.length !== 3) { return { ok: false, error: "notShareLink" }; }
  const [host, shareId, keyText] = parts as [string, string, string];
  if (!HOST.test(host)) { return { ok: false, error: "badHost" }; }
  if (!isShareId(shareId)) { return { ok: false, error: "badShareId" }; }
  const key = decodeKey(keyText);
  if (!key) { return { ok: false, error: "badKey" }; }
  return { ok: true, link: { relayUrl: `https://${host}`, shareId, key } };
}

function decodeKey(text: string): Uint8Array | undefined {
  if (!KEY.test(text)) { return undefined; }
  try {
    const key = base64UrlToBytes(text);
    return key.length === SHARE_LINK_KEY_BYTES ? key : undefined;
  } catch {
    // TRAP: 22 base64url characters hold 132 bits, so a last character with stray low bits is not canonical and throws.
    return undefined;
  }
}
