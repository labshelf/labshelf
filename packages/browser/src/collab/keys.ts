// Keeps the key and relay list of each share per library, and the member's display name, in extension storage.
import { base64UrlToBytes, bytesToBase64Url, isHttpsUrl, isRecord, type InviteRelay, type ShareKeyStore, type StoredInvite } from "@labshelf/core";
import { bx } from "../platform";

/** `libraryId` names the library open at the time of each call; the user can switch libraries while the page is open. */
export function createShareKeyStore(libraryId: () => Promise<string>): ShareKeyStore {
  const update = async (change: (shares: Record<string, unknown>) => void): Promise<void> => {
    const library = await libraryId();
    const record = await readStoredShares();
    const shares = { ...readLibraryShares(record, library) };
    change(shares);
    await writeStoredShares(withLibraryShares(record, library, shares));
  };
  return {
    remember: ({ shareId, shareKey, relays }) => update((shares) => { shares[shareId] = { key: bytesToBase64Url(shareKey), relays }; }),
    forget: (shareId) => update((shares) => { delete shares[shareId]; }),
    invite: async (shareId) => {
      const library = await libraryId();
      // INVARIANT: the share workflows ask only for share ids of this library's projects or connections, which the migration needs.
      await updateUnscopedShares(library, [shareId]);
      const share = parseStoredShare(readLibraryShares(await readStoredShares(), library)[shareId]);
      return share === undefined ? undefined : decoded(shareId, share);
    },
  };
}

function decoded(shareId: string, share: { key: string; relays: StoredInvite["relays"] }): StoredInvite | undefined {
  try {
    return { shareId, shareKey: base64UrlToBytes(share.key), relays: share.relays };
  } catch {
    // A key that does not decode is no usable key, which is what `undefined` reports; the entry stays for inspection.
    return undefined;
  }
}

export async function writeMemberName(name: string): Promise<void> {
  await writeStoredShares({ ...(await readStoredShares()), displayName: name });
}

export async function readMemberName(): Promise<string | undefined> {
  const name = (await readStoredShares())["displayName"];
  return typeof name === "string" ? name : undefined;
}

// INVARIANT: extension-local storage only; sync storage would copy share keys to other devices.
const SHARES_STORAGE_KEY = "collabShares";

function toRelay(value: unknown): InviteRelay | undefined {
  if (!isRecord(value) || typeof value["url"] !== "string" || !isHttpsUrl(value["url"])) { return undefined; }
  return typeof value["relayToken"] === "string" ? { url: value["url"], relayToken: value["relayToken"] } : { url: value["url"] };
}

/** One stored `{ key, relays }` entry, with the key still in base64url; undefined for an entry of the wrong shape. */
export function parseStoredShare(value: unknown): { key: string; relays: InviteRelay[] } | undefined {
  if (!isRecord(value) || typeof value["key"] !== "string" || !Array.isArray(value["relays"])) { return undefined; }
  const relays = value["relays"].map(toRelay);
  return relays.every((relay) => relay !== undefined) ? { key: value["key"], relays: relays as InviteRelay[] } : undefined;
}

/**
 * The stored record as it is: `libraries` maps a library id to its shares by share id, `displayName` is global.
 * INVARIANT: writes change only the entries they touch, so an entry of the wrong shape is skipped on read but never destroyed.
 */
export async function readStoredShares(): Promise<Record<string, unknown>> {
  const raw = ((await bx.storage.local.get(SHARES_STORAGE_KEY)) as Record<string, unknown>)[SHARES_STORAGE_KEY];
  return isRecord(raw) ? raw : {};
}

export const writeStoredShares = (record: Record<string, unknown>): Promise<void> => bx.storage.local.set({ [SHARES_STORAGE_KEY]: record });

/** The shares of one library as stored, entries of the wrong shape included. */
export function readLibraryShares(record: Record<string, unknown>, libraryId: string): Record<string, unknown> {
  const libraries = isRecord(record["libraries"]) ? record["libraries"] : {};
  return isRecord(libraries[libraryId]) ? libraries[libraryId] : {};
}

export function withLibraryShares(record: Record<string, unknown>, libraryId: string, shares: Record<string, unknown>): Record<string, unknown> {
  const libraries = isRecord(record["libraries"]) ? record["libraries"] : {};
  return { ...record, libraries: { ...libraries, [libraryId]: shares } };
}

// Moves share keys stored without a library under the library whose projects hold their share ids.
// Delete `updateUnscopedShares` when no installed extension can still hold a `collabShares.shares` record, which only versions that kept shares without library ids wrote.
/**
 * `shareIds` are the share ids of projects in the library's folder; an unscoped entry no project of this library holds stays
 * for the library that does. TRAP: never pass a share id only because its tab is open, since the tab may name another library's project.
 */
export async function updateUnscopedShares(libraryId: string, shareIds: Iterable<string>): Promise<void> {
  const record = await readStoredShares();
  if (!isRecord(record["shares"])) return;
  const unscoped = { ...record["shares"] };
  const scoped = { ...readLibraryShares(record, libraryId) };
  let moved = false;
  for (const shareId of shareIds) {
    // A malformed entry stays where it is, so nothing that might still be read is lost.
    if (parseStoredShare(unscoped[shareId]) === undefined) continue;
    scoped[shareId] ??= unscoped[shareId];
    delete unscoped[shareId];
    moved = true;
  }
  if (!moved) return;
  const next: Record<string, unknown> = { ...record, shares: unscoped };
  if (Object.keys(unscoped).length === 0) delete next["shares"];
  await writeStoredShares(withLibraryShares(next, libraryId, scoped));
}
