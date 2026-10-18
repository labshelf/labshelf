// Caches PaperRecord objects persistently, derived from the metadata.yaml files, so reads never re-parse YAML.
import type { PaperRecord } from "@labshelf/core";
import { getDb } from "./idb";

/** Upserts a PaperRecord into the metadata cache. */
export async function upsertRecord(record: PaperRecord, folderPath: string): Promise<void> {
  const db = await getDb();
  await db.put("metadata", { paperId: record.id, record, folderPath });
}

/** Removes a PaperRecord from the cache by its id. */
export async function deleteRecord(paperId: string): Promise<void> {
  const db = await getDb();
  await db.delete("metadata", paperId);
}

/** Returns one cached PaperRecord by id, or undefined when the library does not hold it. */
export async function getRecord(paperId: string): Promise<PaperRecord | undefined> {
  const db = await getDb();
  return (await db.get("metadata", paperId))?.record;
}

/** Returns all cached PaperRecords, unordered. */
export async function listAllRecords(): Promise<PaperRecord[]> {
  const db = await getDb();
  const rows = await db.getAll("metadata");
  return rows.map((r) => r.record);
}

/** Replaces the whole cache with these records in one transaction, so a reader never sees it half-filled. */
export async function replaceAllRecords(records: readonly PaperRecord[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction("metadata", "readwrite");
  await tx.store.clear();
  for (const record of records) await tx.store.put({ paperId: record.id, record, folderPath: record.path });
  await tx.done;
}
