// Keeps the list of the shares this browser made of a library in extension storage, one entry per library.
import type { ShareRegistryStore } from "@labshelf/core";

/** The part of `bx.storage.local` the list needs; the list never goes to sync storage, since it holds link keys. */
export interface ShareListArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const shareListName = (libraryId: string): string => `labshelf:share-links:${libraryId}`;

// CONTRACT: documents/contracts/share-link.md#share-list
/** `libraryId` is asked on every call, so the store follows the library the page serves. */
export function createBrowserShareRegistryStore(area: ShareListArea, libraryId: () => Promise<string>): ShareRegistryStore {
  return {
    read: async () => {
      const key = shareListName(await libraryId());
      const stored = (await area.get(key))[key];
      // A value that is not text reads as text core refuses, so it is never written over.
      return stored === undefined ? undefined : typeof stored === "string" ? stored : String(stored);
    },
    write: async (text) => { await area.set({ [shareListName(await libraryId())]: text }); },
    // PLATFORM: a Web Lock is held across every tab of the profile, so two library pages edit the list one at a time.
    exclusive: async (run) => navigator.locks.request(shareListName(await libraryId()), { mode: "exclusive" }, run),
  };
}
