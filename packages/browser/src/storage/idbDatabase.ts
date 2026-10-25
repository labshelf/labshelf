/**
 * Opens (and upgrades) the "labshelf" IndexedDB database. Returns a singleton
 * promise so callers share one connection across the extension lifetime.
 */
import { openDB, type IDBPTransaction } from "idb";
import type { IDBPDatabase } from "idb";
import type { IdbSchema } from "./idbSchema";

export const DB_VERSION = 4;

type UpgradeTx = IDBPTransaction<IdbSchema, string[], "versionchange">;

function createHistoryStores(db: IDBPDatabase<IdbSchema>): void {
  db.createObjectStore("historyLog", { keyPath: "projectId" });
  db.createObjectStore("historyObjects", { keyPath: "hash" });
}

/** Brings a database from `oldVersion` (0 for a new one) to DB_VERSION. */
export function applyDbUpgrade(db: IDBPDatabase<IdbSchema>, oldVersion: number, tx: UpgradeTx): void {
  if (oldVersion < 1) {
    db.createObjectStore("files", { keyPath: "path" });
    db.createObjectStore("metadata", { keyPath: "paperId" });
    createHistoryStores(db);
    return;
  }
  if (oldVersion < 2) {
    // Version 1 indexed files by hash and metadata by folder; nothing queries them.
    for (const [store, index] of [["files", "byHash"], ["metadata", "byFolder"]] as const) {
      const objectStore = tx.objectStore(store);
      if (objectStore.indexNames.contains(index as never)) objectStore.deleteIndex(index);
    }
  }
  if (oldVersion < 3) {
    // Versions 1 and 2 had a "manifest" store that the schema types do not name, hence the casts.
    if (db.objectStoreNames.contains("manifest" as never)) db.deleteObjectStore("manifest" as never);
  }
  if (oldVersion < 4) createHistoryStores(db);
}

const DB_NAME = "labshelf";

let _db: Promise<IDBPDatabase<IdbSchema>> | null = null;

/** Returns a shared connection to the labshelf IndexedDB. */
export function openDb(): Promise<IDBPDatabase<IdbSchema>> {
  if (!_db) {
    _db = openDB<IdbSchema>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, tx) => applyDbUpgrade(db, oldVersion, tx),
    });
  }
  return _db;
}
