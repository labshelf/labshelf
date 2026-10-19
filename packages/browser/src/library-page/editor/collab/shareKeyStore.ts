// Keeps the key and relay list of each joined share, and the member's display name, in extension storage.
import { base64UrlToBytes, bytesToBase64Url, isHttpsUrl, type InviteRelay } from "@labshelf/core";
import { bx } from "../../../platform";

const STORAGE_KEY = "collabShares";

/** The relay URL lives only in the invite, so a project reconnects after a reload from what is kept here. */
export interface StoredShare {
  shareKey: Uint8Array;
  relays: InviteRelay[];
}

interface StoredShares {
  /** Base64url share key and relays by share id. */
  shares: Record<string, { key: string; relays: InviteRelay[] }>;
  displayName?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function toRelay(value: unknown): InviteRelay | undefined {
  if (!isRecord(value) || typeof value["url"] !== "string" || !isHttpsUrl(value["url"])) { return undefined; }
  return typeof value["relayToken"] === "string" ? { url: value["url"], relayToken: value["relayToken"] } : { url: value["url"] };
}

function toShare(value: unknown): { key: string; relays: InviteRelay[] } | undefined {
  if (!isRecord(value) || typeof value["key"] !== "string" || !Array.isArray(value["relays"])) { return undefined; }
  const relays = value["relays"].map(toRelay);
  return relays.every((relay) => relay !== undefined) ? { key: value["key"], relays: relays as InviteRelay[] } : undefined;
}

/** Storage is outside the type system, so entries of the wrong shape are dropped. */
async function readStored(): Promise<StoredShares> {
  const raw = ((await bx.storage.local.get(STORAGE_KEY)) as Record<string, unknown>)[STORAGE_KEY];
  const record = isRecord(raw) ? raw : {};
  const stored = isRecord(record["shares"]) ? record["shares"] : {};
  const shares = Object.fromEntries(Object.entries(stored).flatMap(([id, value]) => { const share = toShare(value); return share ? [[id, share]] : []; }));
  const displayName = typeof record["displayName"] === "string" ? record["displayName"] : undefined;
  return displayName === undefined ? { shares } : { shares, displayName };
}

const writeStored = (stored: StoredShares): Promise<void> => bx.storage.local.set({ [STORAGE_KEY]: stored });

export async function saveShare(shareId: string, shareKey: Uint8Array, relays: InviteRelay[]): Promise<void> {
  const stored = await readStored();
  await writeStored({ ...stored, shares: { ...stored.shares, [shareId]: { key: bytesToBase64Url(shareKey), relays } } });
}

export async function loadShare(shareId: string): Promise<StoredShare | undefined> {
  const share = (await readStored()).shares[shareId];
  if (share === undefined) { return undefined; }
  try {
    return { shareKey: base64UrlToBytes(share.key), relays: share.relays };
  } catch {
    return undefined;
  }
}

export async function saveDisplayName(name: string): Promise<void> {
  await writeStored({ ...(await readStored()), displayName: name });
}

export async function loadDisplayName(): Promise<string | undefined> {
  return (await readStored()).displayName;
}
