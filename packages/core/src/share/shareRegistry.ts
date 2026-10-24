// Reads and writes the device's list of the shares it made, through a store port the app backs with a file.
import { isSha256Hex, isShareId } from "../relay/index.js";
import { base64UrlToBytes } from "../encoding/index.js";
import { formatShareLink } from "./shareLink.js";

// CONTRACT: documents/contracts/share-link.md#share-list
export interface ShareRecord {
  id: string;
  folder: string;
  relayUrl: string;
  /** The link key in base64url, so the device can show the link again. */
  key: string;
  createdAt: string;
  /** Every blob hash the share's manifest names. */
  blobs: string[];
}

export interface ShareRegistry { shares: ShareRecord[] }

/**
 * The text of `shares.json`; `read` answers undefined when the file does not exist, and `write` replaces it atomically.
 * `exclusive` runs one section at a time across every store of the same list, so a read-modify-write loses no other edit.
 */
export interface ShareRegistryStore {
  read(): Promise<string | undefined>;
  write(text: string): Promise<void>;
  exclusive<T>(run: () => Promise<T>): Promise<T>;
}

type Json = Record<string, unknown>;

function recordOf(value: unknown): ShareRecord | undefined {
  if (typeof value !== "object" || value === null) { return undefined; }
  const { id, folder, relayUrl, key, createdAt, blobs } = value as Json;
  const fields = [folder, relayUrl, key, createdAt];
  if (!isShareId(id) || !fields.every((field) => typeof field === "string")) { return undefined; }
  if (!Array.isArray(blobs) || !blobs.every((hash) => isSha256Hex(hash))) { return undefined; }
  return { id, folder: folder as string, relayUrl: relayUrl as string, key: key as string, createdAt: createdAt as string, blobs };
}

/** Throws when the file is not a share list, so no caller writes over the shares it still lists. */
export async function loadShareRegistry(store: ShareRegistryStore): Promise<ShareRegistry> {
  const text = await store.read();
  if (text === undefined) { return { shares: [] }; }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`The share list is not JSON (${String(error)}); fix or remove shares.json`);
  }
  const shares = (parsed as Json | null)?.["shares"];
  if (!Array.isArray(shares)) { throw new Error("The share list has no shares array; fix or remove shares.json"); }
  return { shares: shares.map(recordOf).filter((record): record is ShareRecord => record !== undefined) };
}

// CONTRACT: documents/contracts/share-link.md#share-list
/** Re-reads the list inside the store's exclusive section, so the change applies to what is listed now. */
export function updateShareRegistry(store: ShareRegistryStore, change: (registry: ShareRegistry) => ShareRegistry): Promise<void> {
  return store.exclusive(async () => {
    const changed = change(await loadShareRegistry(store));
    await store.write(`${JSON.stringify(changed, null, 2)}\n`);
  });
}

export function shareRecordLink(record: ShareRecord): string {
  return formatShareLink({ relayUrl: record.relayUrl, shareId: record.id, key: base64UrlToBytes(record.key) });
}
