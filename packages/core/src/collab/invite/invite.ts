// Formats the invite link that carries a share key, parses one from pasted text, and encodes the relay list it carries.
import { base64UrlToBytes, bytesToBase64Url, decodeKeyBytes } from "../../encoding/index.js";
import { SHARE_KEY_BYTES, deriveShareId } from "./shareKey.js";

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

/** A joiner reaches the share only through a relay, so an invite that lists none cannot be joined. */
export class InviteWithoutRelayError extends Error {
  constructor() {
    super("The invite lists no relay. Ask the owner for a new invite after they connect Cloudflare.");
    this.name = "InviteWithoutRelayError";
  }
}

export function assertInviteHasRelay(invite: Invite): void {
  if (invite.relays.length === 0) { throw new InviteWithoutRelayError(); }
}

export async function formatInvite(share: { shareKey: Uint8Array; relays: InviteRelay[] }): Promise<string> {
  const segments = [INVITE_VERSION, await deriveShareId(share.shareKey), bytesToBase64Url(share.shareKey), encodeRelayList(share.relays)];
  return INVITE_PREFIX + segments.join(".");
}

/** Finds the link anywhere in pasted text; never throws on user input. */
export async function parseInvite(text: string): Promise<ParseInviteResult> {
  // A sentence may end right after the link, and no segment ends in these characters, so they are punctuation.
  const fragment = /labshelf:\/\/join#(\S+)/.exec(text)?.[1]?.replace(/[.,;:!?)\]}>"']+$/, "");
  const segments = fragment?.split(".") ?? [];
  if (!/^v\d+$/.test(segments[0] ?? "")) { return { ok: false, error: "notAnInvite" }; }
  if (segments[0] !== INVITE_VERSION) { return { ok: false, error: "unsupportedVersion" }; }
  if (segments.length !== 4) { return { ok: false, error: "notAnInvite" }; }
  const [, shareId, keyText, relayText] = segments as [string, string, string, string];
  if (!/^[0-9a-f]{32}$/.test(shareId)) { return { ok: false, error: "badShareId" }; }
  const shareKey = decodeKeyBytes(keyText, SHARE_KEY_BYTES);
  if (!shareKey) { return { ok: false, error: "badKey" }; }
  const relays = decodeRelayList(relayText);
  if (!relays) { return { ok: false, error: "badRelayList" }; }
  if ((await deriveShareId(shareKey)) !== shareId) { return { ok: false, error: "shareIdMismatch" }; }
  return { ok: true, invite: { shareId, shareKey, relays } };
}

export interface InviteRelay {
  url: string;
  relayToken?: string;
}

function encodeRelayList(relays: InviteRelay[]): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(relays)));
}

export function isHttpsUrl(text: string): boolean {
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
function decodeRelayList(text: string): InviteRelay[] | undefined {
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
