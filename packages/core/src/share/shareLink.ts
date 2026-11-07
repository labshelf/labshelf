// Writes and parses share links, whose fragment carries the Worker host and the link key, and writes the vscode:// URI through which the share page asks LabShelf in VS Code to import a share.
import { deriveShareId } from "../shareKey/index.js";
import { bytesToBase64Url, decodeKeyBytes } from "../encoding/index.js";
import { formatRelayHost, parseRelayHost } from "../relay/index.js";

// CONTRACT: documents/contracts/share-link.md#link
export const SHARE_PAGE_ORIGIN = "https://labshelf.org";
export const SHARE_PAGE_PATH = "/s/";
export const SHARE_LINK_KEY_BYTES = 16;

export interface ShareLink {
  /** `https://<worker host>`, the Worker that serves the share. */
  relayUrl: string;
  key: Uint8Array;
}

/** A link with the share id its key derives; the id is never in the link. */
export interface ShareLinkParts extends ShareLink {
  shareId: string;
}

export type ShareLinkError = "notShareLink" | "badHost" | "badKey";
export type ShareLinkResult = { ok: true; link: ShareLink } | { ok: false; error: ShareLinkError };

export function formatShareLink({ relayUrl, key }: ShareLink): string {
  return `${SHARE_PAGE_ORIGIN}${SHARE_PAGE_PATH}#${formatRelayHost(relayUrl)}.${bytesToBase64Url(key)}`;
}

/** Never throws: any text that is not a well-formed share link is a typed error. */
export function parseShareLink(text: string): ShareLinkResult {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { ok: false, error: "notShareLink" };
  }
  // PLATFORM: VS Code's Uri percent-encodes a fragment when it hands a link to the browser; no valid part holds a %.
  let fragment: string;
  try {
    fragment = decodeURIComponent(url.hash.slice(1));
  } catch {
    return { ok: false, error: "notShareLink" };
  }
  const dot = fragment.lastIndexOf(".");
  if (!url.pathname.endsWith(SHARE_PAGE_PATH) || dot <= 0) { return { ok: false, error: "notShareLink" }; }
  const relayUrl = parseRelayHost(fragment.slice(0, dot));
  if (!relayUrl) { return { ok: false, error: "badHost" }; }
  const key = decodeKeyBytes(fragment.slice(dot + 1), SHARE_LINK_KEY_BYTES);
  if (!key) { return { ok: false, error: "badKey" }; }
  return { ok: true, link: { relayUrl, key } };
}

export async function resolveShareLink(link: ShareLink): Promise<ShareLinkParts> {
  return { ...link, shareId: await deriveShareId(link.key) };
}

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
/** `<publisher>.<name>` of the VS Code extension; VS Code routes a vscode:// URI to the extension its authority names. */
export const VSCODE_EXTENSION_ID = "labshelf.labshelf";
export const SHARE_IMPORT_PATH = "/importShare";

export function formatShareImportUri(link: ShareLink): string {
  return `vscode://${VSCODE_EXTENSION_ID}${SHARE_IMPORT_PATH}?link=${encodeURIComponent(formatShareLink(link))}`;
}
