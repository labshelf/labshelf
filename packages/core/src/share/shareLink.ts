// Writes and parses share links, whose fragment carries the Worker host, the share id and the link key, and writes the vscode:// URI through which the share page asks LabShelf in VS Code to import a share.
import { bytesToBase64Url, decodeKeyBytes } from "../encoding/index.js";
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
  const key = decodeKeyBytes(keyText, SHARE_LINK_KEY_BYTES);
  if (!key) { return { ok: false, error: "badKey" }; }
  return { ok: true, link: { relayUrl: `https://${host}`, shareId, key } };
}

// CONTRACT: documents/contracts/share-link.md#open-in-labshelf
/** `<publisher>.<name>` of the VS Code extension; VS Code routes a vscode:// URI to the extension its authority names. */
export const VSCODE_EXTENSION_ID = "labshelf.labshelf";
export const SHARE_IMPORT_PATH = "/importShare";

export function formatShareImportUri(link: ShareLinkParts): string {
  return `vscode://${VSCODE_EXTENSION_ID}${SHARE_IMPORT_PATH}?link=${encodeURIComponent(formatShareLink(link))}`;
}
