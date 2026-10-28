// Stores each share's collaboration state and this device's identity in the "labshelf-collab" IndexedDB database, outside the library files.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEVICE_ID, type CollabDeviceStateStorage, type DeviceIdentity, type ILogger, type StoredDoc } from "@labshelf/core";

/** Namespaces keep library identity separate from each share's state. */
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
export const createNamespaceRange = (ns: string): IDBKeyRange => IDBKeyRange.bound([ns], [ns, []]);

/** A shared connection, opened again after the browser closes it. */
export function openCollabDb(): Promise<IDBPDatabase<CollabSchema>> {
  db ??= openDB<CollabSchema>("labshelf-collab", 1, {
    upgrade: (database) => { COLLAB_STORES.forEach((name) => database.createObjectStore(name)); },
    terminated: () => { db = undefined; },
  });
  return db;
}

/** `ns` is `<library id>/<share id>`; the storage sees only the keys under it. */
export function openBrowserCollabStorage(ns: string): CollabDeviceStateStorage {
  const docUpdates = (docId: string) => IDBKeyRange.bound([ns, docId, 0], [ns, docId, Infinity]);
  return {
    // IDB keys may hold paths, and this store lives outside the library files, so the doc key needs no hashing.
    docId: (docKey) => docKey,
    loadDocs: async () => {
      const tx = (await openCollabDb()).transaction(["docs", "updates"]);
      const docs = new Map<string, StoredDoc>();
      const docOf = (docId: string) => docs.get(docId) ?? docs.set(docId, { updates: [], torn: false }).get(docId)!;
      for (let cursor = await tx.objectStore("docs").openCursor(createNamespaceRange(ns)); cursor; cursor = await cursor.continue()) {
        docOf(cursor.key[1]).snapshot = cursor.value;
      }
      // INVARIANT: a cursor walks keys in order, so each doc's updates arrive in append order.
      for (let cursor = await tx.objectStore("updates").openCursor(createNamespaceRange(ns)); cursor; cursor = await cursor.continue()) {
        docOf(cursor.key[1]).updates.push(cursor.value);
      }
      return docs;
    },
    compactDoc: async (docId, state) => {
      const tx = (await openCollabDb()).transaction(["docs", "updates"], "readwrite");
      await Promise.all([tx.objectStore("docs").put(state, [ns, docId]), tx.objectStore("updates").delete(docUpdates(docId)), tx.done]);
    },
    appendUpdate: async (docId, update) => {
      const tx = (await openCollabDb()).transaction("updates", "readwrite");
      const last = await tx.store.openKeyCursor(docUpdates(docId), "prev");
      await Promise.all([tx.store.put(update, [ns, docId, (last ? last.key[2] : 0) + 1]), tx.done]);
    },
    loadMap: async (name) => (await openCollabDb()).get("maps", [ns, name]),
    saveMap: async (name, entries) => { await (await openCollabDb()).put("maps", entries, [ns, name]); },
    readBlob: async (hash) => (await openCollabDb()).get("blobs", [ns, hash]),
    writeBlob: async (hash, bytes) => { await (await openCollabDb()).put("blobs", bytes, [ns, hash]); },
  };
}

export function createBrowserDeviceIdentity(libraryId: string, logger: ILogger): DeviceIdentity {
  return {
    async id() {
      try {
        const tx = (await openCollabDb()).transaction("maps", "readwrite");
        const key: [string, string] = [`library:${libraryId}`, "device-identity"];
        const saved = await tx.store.get(key);
        const id = saved?.["id"] ?? crypto.randomUUID();
        if (typeof id !== "string" || !DEVICE_ID.test(id)) {
          await tx.done;
          throw new Error(`Invalid device identity for library ${libraryId}`);
        }
        await Promise.all([!saved ? tx.store.put({ id }, key) : undefined, tx.done]);
        if (!saved) { await logger.log("INFO", "storage.deviceIdentity", "Created a device identity", { libraryId, id }); }
        return id;
      } catch (error) {
        await logger.error("storage.deviceIdentity", error, { libraryId });
        throw error;
      }
    },
  };
}

export async function removeBrowserCollabDocs(ns: string): Promise<void> {
  const tx = (await openCollabDb()).transaction(COLLAB_STORES, "readwrite");
  await Promise.all([...COLLAB_STORES.map((name) => tx.objectStore(name).delete(createNamespaceRange(ns))), tx.done]);
}
