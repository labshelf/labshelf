// Formats the invite link that carries a share key and the hosts of its relays, and parses one from pasted text.
import { bytesToBase64Url, decodeKeyBytes } from "../encoding/index.js";
import { formatRelayHost, parseRelayHost } from "../relay/index.js";
import { SHARE_KEY_BYTES, deriveShareId } from "../shareKey/index.js";

// The secrets sit in the fragment so they never reach a server that sees the URL.
const INVITE_PREFIX = "labshelf://join#";
const INVITE_VERSION = "v1";
const RELAY_SEPARATOR = "~";

export interface Invite {
  shareId: string;
  shareKey: Uint8Array;
  relays: InviteRelay[];
}

export type InviteError =
  | "notAnInvite"
  | "unsupportedVersion"
  | "badKey"
  | "badRelayList";
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
  const key = bytesToBase64Url(share.shareKey);
  const relays = share.relays.map((relay) => formatRelayHost(relay.url)).join(RELAY_SEPARATOR);
  return `${INVITE_PREFIX}${INVITE_VERSION}.${key}${relays === "" ? "" : `.${relays}`}`;
}

/** Finds the link anywhere in pasted text; never throws on user input. */
export async function parseInvite(text: string): Promise<ParseInviteResult> {
  // A sentence may end right after the link, and no segment ends in these characters, so they are punctuation.
  const fragment = /labshelf:\/\/join#(\S+)/.exec(text)?.[1]?.replace(/[.,;:!?)\]}>"']+$/, "");
  const versionEnd = fragment?.indexOf(".") ?? -1;
  const version = fragment === undefined ? "" : versionEnd < 0 ? fragment : fragment.slice(0, versionEnd);
  if (fragment === undefined || !/^v\d+$/.test(version)) { return { ok: false, error: "notAnInvite" }; }
  if (version !== INVITE_VERSION) { return { ok: false, error: "unsupportedVersion" }; }
  const rest = versionEnd < 0 ? "" : fragment.slice(versionEnd + 1);
  const keyEnd = rest.indexOf(".");
  const shareKey = decodeKeyBytes(keyEnd < 0 ? rest : rest.slice(0, keyEnd), SHARE_KEY_BYTES);
  if (!shareKey) { return { ok: false, error: "badKey" }; }
  const relays: InviteRelay[] = [];
  if (keyEnd >= 0) {
    for (const entry of rest.slice(keyEnd + 1).split(RELAY_SEPARATOR)) {
      const url = parseRelayHost(entry);
      if (entry === "" || !url) { return { ok: false, error: "badRelayList" }; }
      relays.push({ url });
    }
  }
  return { ok: true, invite: { shareId: await deriveShareId(shareKey), shareKey, relays } };
}

export interface InviteRelay {
  url: string;
}

export function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}
