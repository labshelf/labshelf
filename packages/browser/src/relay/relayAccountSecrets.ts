// Holds the relay owner's credentials as named secret slots in their own IndexedDB database.
// INVARIANT: owner secrets stay in the extension-origin IndexedDB, which content scripts (web-page origin) cannot read,
// unlike bx.storage.local; a separate database keeps a library reset or rebuild away from the credentials.
import { openDB, type IDBPDatabase } from "idb";
import type { SecretSlot } from "@labshelf/core";

const DB_NAME = "labshelf-relay-account";
const STORE = "secrets";

let opening: Promise<IDBPDatabase> | undefined;

function secretsDb(): Promise<IDBPDatabase> {
  opening ??= openDB(DB_NAME, 1, { upgrade: (db) => { db.createObjectStore(STORE); } }).catch((error: unknown) => {
    opening = undefined;
    throw error;
  });
  return opening;
}

export function relayAccountSlot(name: "account" | "tokens"): SecretSlot {
  return {
    get: async () => (await (await secretsDb()).get(STORE, name)) as string | undefined,
    store: async (value) => { await (await secretsDb()).put(STORE, value, name); },
    delete: async () => { await (await secretsDb()).delete(STORE, name); },
  };
}
