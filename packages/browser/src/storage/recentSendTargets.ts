// Keeps the reader's recent "Send to…" targets per device in chrome.storage.local, never in the library.
import type { IKeyValueStore } from "@labshelf/core";
import { bx } from "../platform";

export function createRecentSendTargetsStore(): IKeyValueStore {
  return {
    get: async (key) => (await bx.storage.local.get(key))[key],
    set: async (key, value) => { await bx.storage.local.set({ [key]: value }); },
  };
}
