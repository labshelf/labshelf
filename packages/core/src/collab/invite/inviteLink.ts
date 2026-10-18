// Formats the invite link that carries a share key, and parses one from pasted text.
import { base64UrlToBytes, bytesToBase64Url } from "../../encoding/index.js";
import { SHARE_KEY_BYTES, deriveShareId } from "../crypto/index.js";
import { decodeRelayList, encodeRelayList } from "./relayList.js";
import type { InviteRelay } from "./relayList.js";

// The secrets sit in the fragment so they never reach a server that sees the URL.
const INVITE_PREFIX = "labshelf://join#";
const INVITE_VERSION = "v1";

export interface Invite {
  shareId: string;
  shareKey: Uint8Array;
  relays: InviteRelay[];
}

export type InviteError =
  | "notAnInvite"
  | "unsupportedVersion"
  | "badShareId"
  | "badKey"
  | "badRelayList"
  | "shareIdMismatch";
export type ParseInviteResult = { ok: true; invite: Invite } | { ok: false; error: InviteError };

export async function formatInvite(share: { shareKey: Uint8Array; relays: InviteRelay[] }): Promise<string> {
  const segments = [INVITE_VERSION, await deriveShareId(share.shareKey), bytesToBase64Url(share.shareKey), encodeRelayList(share.relays)];
  return INVITE_PREFIX + segments.join(".");
}

function decodeKey(text: string): Uint8Array | undefined {
  try {
    const bytes = base64UrlToBytes(text);
    return bytes.length === SHARE_KEY_BYTES ? bytes : undefined;
  } catch {
    return undefined;
  }
}

/** Finds the link anywhere in pasted text; never throws on user input. */
export async function parseInvite(text: string): Promise<ParseInviteResult> {
  const fragment = /labshelf:\/\/join#(\S+)/.exec(text.trim())?.[1];
  const segments = fragment?.split(".") ?? [];
  if (!/^v\d+$/.test(segments[0] ?? "")) { return { ok: false, error: "notAnInvite" }; }
  if (segments[0] !== INVITE_VERSION) { return { ok: false, error: "unsupportedVersion" }; }
  if (segments.length !== 4) { return { ok: false, error: "notAnInvite" }; }
  const [, shareId, keyText, relayText] = segments as [string, string, string, string];
  if (!/^[0-9a-f]{32}$/.test(shareId)) { return { ok: false, error: "badShareId" }; }
  const shareKey = decodeKey(keyText);
  if (!shareKey) { return { ok: false, error: "badKey" }; }
  const relays = decodeRelayList(relayText);
  if (!relays) { return { ok: false, error: "badRelayList" }; }
  if ((await deriveShareId(shareKey)) !== shareId) { return { ok: false, error: "shareIdMismatch" }; }
  return { ok: true, invite: { shareId, shareKey, relays } };
}
