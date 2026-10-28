/** Holds a share's collaboration state in memory, with switchable write failures, for tests of the store rules. */
import type { CollabDeviceStateStorage, DeviceStateMapName, StoredDoc } from "../../../src/collab/session/index";

export interface MemoryStorage extends CollabDeviceStateStorage {
  readonly docs: Map<string, StoredDoc>;
  readonly maps: Map<DeviceStateMapName, unknown>;
  readonly blobs: Map<string, Uint8Array>;
  readonly compactions: string[];
  failAppends: boolean;
  failCompactions: boolean;
}

export function memoryStorage(): MemoryStorage {
  const docs = new Map<string, StoredDoc>();
  const maps = new Map<DeviceStateMapName, unknown>();
  const blobs = new Map<string, Uint8Array>();
  const compactions: string[] = [];
  const storage: MemoryStorage = {
    docs, maps, blobs, compactions, failAppends: false, failCompactions: false,
    docId: (docKey) => `doc:${docKey}`,
    loadDocs: async () => new Map([...docs].map(([id, doc]) => [id, { ...doc, updates: [...doc.updates] }])),
    compactDoc: async (docId, state) => {
      if (storage.failCompactions) { throw new Error("disk full"); }
      compactions.push(docId);
      docs.set(docId, { snapshot: state, updates: [], torn: false });
    },
    appendUpdate: async (docId, update) => {
      if (storage.failAppends) { throw new Error("disk full"); }
      const doc = docs.get(docId) ?? { updates: [], torn: false };
      docs.set(docId, { ...doc, updates: [...doc.updates, update] });
    },
    loadMap: async (name) => maps.get(name),
    saveMap: async (name, entries) => { maps.set(name, structuredClone(entries)); },
    readBlob: async (hash) => blobs.get(hash),
    writeBlob: async (hash, bytes) => { blobs.set(hash, bytes); },
  };
  return storage;
}
