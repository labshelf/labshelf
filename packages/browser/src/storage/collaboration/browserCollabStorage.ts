// Stores a share's collaboration state in IndexedDB, where every write is durable once its transaction completes.
// CONTRACT: documents/contracts/collaboration.md#device-local-state
import type { CollabStateStorage, StoredDoc } from "@labshelf/core";
import { collabDb, namespaceRange } from "./collabDb";

/** `ns` is `<library id>/<share id>`; the storage sees only the keys under it. */
export function openBrowserCollabStorage(ns: string): CollabStateStorage {
  const docUpdates = (docId: string) => IDBKeyRange.bound([ns, docId, 0], [ns, docId, Infinity]);
  return {
    // IDB keys may hold paths, and this store lives outside the library files, so the doc key needs no hashing.
    docId: (docKey) => docKey,
    loadDocs: async () => {
      const tx = (await collabDb()).transaction(["docs", "updates"]);
      const docs = new Map<string, StoredDoc>();
      const docOf = (docId: string) => docs.get(docId) ?? docs.set(docId, { updates: [], torn: false }).get(docId)!;
      for (let cursor = await tx.objectStore("docs").openCursor(namespaceRange(ns)); cursor; cursor = await cursor.continue()) {
        docOf(cursor.key[1]).snapshot = cursor.value;
      }
      // INVARIANT: a cursor walks keys in order, so each doc's updates arrive in append order.
      for (let cursor = await tx.objectStore("updates").openCursor(namespaceRange(ns)); cursor; cursor = await cursor.continue()) {
        docOf(cursor.key[1]).updates.push(cursor.value);
      }
      return docs;
    },
    compactDoc: async (docId, state) => {
      const tx = (await collabDb()).transaction(["docs", "updates"], "readwrite");
      await Promise.all([tx.objectStore("docs").put(state, [ns, docId]), tx.objectStore("updates").delete(docUpdates(docId)), tx.done]);
    },
    appendUpdate: async (docId, update) => {
      const tx = (await collabDb()).transaction("updates", "readwrite");
      const last = await tx.store.openKeyCursor(docUpdates(docId), "prev");
      await Promise.all([tx.store.put(update, [ns, docId, (last ? last.key[2] : 0) + 1]), tx.done]);
    },
    loadMap: async (name) => (await collabDb()).get("maps", [ns, name]),
    saveMap: async (name, entries) => { await (await collabDb()).put("maps", entries, [ns, name]); },
    readBlob: async (hash) => (await collabDb()).get("blobs", [ns, hash]),
    writeBlob: async (hash, bytes) => { await (await collabDb()).put("blobs", bytes, [ns, hash]); },
  };
}
