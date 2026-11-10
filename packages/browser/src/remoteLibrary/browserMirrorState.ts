// Keeps the Mirror's hash table of this browser in extension storage, one entry per library.
import { parseMirrorState, serializeMirrorState, type MirrorStateStore } from "@labshelf/core";

/** The part of `bx.storage.local` the table needs. */
export interface MirrorStateArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

const mirrorStateName = (libraryId: string): string => `labshelf:remote-mirror:${libraryId}`;

/** `libraryId` is asked on every call, so the store follows the library the page serves. */
export function createBrowserMirrorStateStore(storage: MirrorStateArea, libraryId: () => Promise<string>): MirrorStateStore {
  return {
    read: async () => {
      const key = mirrorStateName(await libraryId());
      const stored = (await storage.get(key))[key];
      // A value that is not a valid table reads as no table, so the next run starts the Mirror over.
      return typeof stored === "string" ? parseMirrorState(stored) : undefined;
    },
    write: async (state) => { await storage.set({ [mirrorStateName(await libraryId())]: serializeMirrorState(state) }); },
    clear: async () => { await storage.remove(mirrorStateName(await libraryId())); },
  };
}
