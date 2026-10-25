// Tells whether a share's device-local state is being stored, by watching every write its storage port makes.
import type { CollabDeviceStateStorage } from "../deviceState/index.js";

export interface StorageHealth {
  /** The error of a write that failed and has not succeeded since; undefined while every write is stored. */
  readonly failure: string | undefined;
  onChange(listener: () => void): () => void;
}

/** Wraps `storage` so each write reports to the returned health; reads pass through. */
export function watchStorageHealth(storage: CollabDeviceStateStorage): { storage: CollabDeviceStateStorage; health: StorageHealth } {
  // Keyed by what was written, so a later write of the same doc, map or blob clears its failure.
  const failing = new Map<string, string>();
  const listeners = new Set<() => void>();
  const failure = (): string | undefined => failing.values().next().value;
  const track = async (key: string, write: () => Promise<void>): Promise<void> => {
    const before = failure();
    try {
      await write();
      failing.delete(key);
    } catch (error) {
      failing.set(key, error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      if (failure() !== before) { listeners.forEach((listener) => listener()); }
    }
  };
  return {
    storage: {
      ...storage,
      compactDoc: (docId, state) => track(`doc ${docId}`, () => storage.compactDoc(docId, state)),
      appendUpdate: (docId, update) => track(`doc ${docId}`, () => storage.appendUpdate(docId, update)),
      saveMap: (name, entries) => track(`map ${name}`, () => storage.saveMap(name, entries)),
      writeBlob: (hash, bytes) => track(`blob ${hash}`, () => storage.writeBlob(hash, bytes)),
    },
    health: {
      get failure() { return failure(); },
      onChange: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    },
  };
}
