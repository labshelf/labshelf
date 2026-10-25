/**
 * Opens (and upgrades) the "labshelf" IndexedDB database. Returns a singleton
 * promise so callers share one connection across the extension lifetime.
 */
import { openDB } from "idb";
import type { IDBPDatabase } from "idb";
import type { LabShelfSchema } from "./idbSchema";
import { DB_VERSION, upgradeDb } from "./idbUpgrade";

const DB_NAME = "labshelf";

let _db: Promise<IDBPDatabase<LabShelfSchema>> | null = null;

/** Returns a shared connection to the labshelf IndexedDB. */
export function getDb(): Promise<IDBPDatabase<LabShelfSchema>> {
  if (!_db) {
    _db = openDB<LabShelfSchema>(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion, _newVersion, tx) => upgradeDb(db, oldVersion, tx),
    });
  }
  return _db;
}
