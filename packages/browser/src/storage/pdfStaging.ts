// Holds the bytes of PDFs offered for attaching until the user attaches or dismisses them.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

// A database of its own, outside the library's file store, so staged bytes never join the library.
const DB_NAME = "labshelf-pdf-staging";
const STORE = "pdfs";
// A row no offer names any more is dropped once it is this old; younger ones may belong to a match still running.
const ORPHAN_MS = 10 * 60_000;

interface StagedPdf {
  id: string;
  bytes: Uint8Array;
  at: number;
}

interface StagingSchema extends DBSchema {
  pdfs: { key: string; value: StagedPdf };
}

let db: Promise<IDBPDatabase<StagingSchema>> | undefined;

function open(): Promise<IDBPDatabase<StagingSchema>> {
  db ??= openDB<StagingSchema>(DB_NAME, 1, { upgrade: (d) => { d.createObjectStore(STORE, { keyPath: "id" }); } });
  return db;
}

export async function stagePdf(id: string, bytes: Uint8Array): Promise<void> {
  await (await open()).put(STORE, { id, bytes, at: Date.now() });
}

export async function stagedPdf(id: string): Promise<Uint8Array | undefined> {
  return (await (await open()).get(STORE, id))?.bytes;
}

export async function unstagePdf(id: string): Promise<void> {
  await (await open()).delete(STORE, id);
}

/** Drops the staged PDFs not in `ids` that are older than a match takes, such as those left by a browser restart. */
export async function keepStagedPdfs(ids: readonly string[]): Promise<void> {
  const store = await open();
  const keep = new Set(ids);
  for (const row of await store.getAll(STORE)) {
    if (!keep.has(row.id) && Date.now() - row.at > ORPHAN_MS) await store.delete(STORE, row.id);
  }
}
