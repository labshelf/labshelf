// Reads and writes the "collabShares" record in extension storage, which holds each library's share keys and the display name.
import { isHttpsUrl, type InviteRelay } from "@labshelf/core";
import { bx } from "../platform";

// INVARIANT: extension-local storage only; sync storage would copy share keys to other devices.
const SHARES_STORAGE_KEY = "collabShares";

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function toRelay(value: unknown): InviteRelay | undefined {
  if (!isRecord(value) || typeof value["url"] !== "string" || !isHttpsUrl(value["url"])) { return undefined; }
  return typeof value["relayToken"] === "string" ? { url: value["url"], relayToken: value["relayToken"] } : { url: value["url"] };
}

/** One stored `{ key, relays }` entry, with the key still in base64url; undefined for an entry of the wrong shape. */
export function toShare(value: unknown): { key: string; relays: InviteRelay[] } | undefined {
  if (!isRecord(value) || typeof value["key"] !== "string" || !Array.isArray(value["relays"])) { return undefined; }
  const relays = value["relays"].map(toRelay);
  return relays.every((relay) => relay !== undefined) ? { key: value["key"], relays: relays as InviteRelay[] } : undefined;
}

/**
 * The stored record as it is: `libraries` maps a library id to its shares by share id, `displayName` is global.
 * INVARIANT: writes change only the entries they touch, so an entry of the wrong shape is skipped on read but never destroyed.
 */
export async function readSharesRecord(): Promise<Record<string, unknown>> {
  const raw = ((await bx.storage.local.get(SHARES_STORAGE_KEY)) as Record<string, unknown>)[SHARES_STORAGE_KEY];
  return isRecord(raw) ? raw : {};
}

export const writeSharesRecord = (record: Record<string, unknown>): Promise<void> => bx.storage.local.set({ [SHARES_STORAGE_KEY]: record });

/** The shares of one library as stored, entries of the wrong shape included. */
export function readLibraryShares(record: Record<string, unknown>, libraryId: string): Record<string, unknown> {
  const libraries = isRecord(record["libraries"]) ? record["libraries"] : {};
  return isRecord(libraries[libraryId]) ? libraries[libraryId] : {};
}

export function withLibraryShares(record: Record<string, unknown>, libraryId: string, shares: Record<string, unknown>): Record<string, unknown> {
  const libraries = isRecord(record["libraries"]) ? record["libraries"] : {};
  return { ...record, libraries: { ...libraries, [libraryId]: shares } };
}
