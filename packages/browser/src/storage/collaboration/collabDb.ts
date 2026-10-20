// Opens the "labshelf-collab" IndexedDB database that holds the collaboration state of every share on this device.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

/** Every key starts with the share namespace `<library id>/<share id>`. */
export interface CollabSchema extends DBSchema {
  docs: { key: [string, string]; value: Uint8Array };
  /** Keyed by namespace, doc id and an append sequence number. */
  updates: { key: [string, string, number]; value: Uint8Array };
  maps: { key: [string, string]; value: Record<string, unknown> };
  blobs: { key: [string, string]; value: Uint8Array };
}

export const COLLAB_STORES = ["docs", "updates", "maps", "blobs"] as const;

let db: Promise<IDBPDatabase<CollabSchema>> | undefined;

/** Bounds every key of the namespace: arrays sort after strings, so `[ns, []]` follows each `[ns, <string>, ...]`. */
export const namespaceRange = (ns: string): IDBKeyRange => IDBKeyRange.bound([ns], [ns, []]);

/** A shared connection, opened again after the browser closes it. */
export function collabDb(): Promise<IDBPDatabase<CollabSchema>> {
  db ??= openDB<CollabSchema>("labshelf-collab", 1, {
    upgrade: (database) => { COLLAB_STORES.forEach((name) => database.createObjectStore(name)); },
    terminated: () => { db = undefined; },
  });
  return db;
}
