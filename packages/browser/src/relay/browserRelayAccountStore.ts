// Opens the relay account store on the extension's IndexedDB slots, refreshing tokens under a Web Lock.
import {
  createRelayAccountStore,
  type ILogger,
  type RelayAccountStore,
  type StoredLock,
  type StoredSecret,
} from "@labshelf/core";
import { openDB, type IDBPDatabase } from "idb";

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

export function createRelayAccountSlot(name: "account" | "tokens"): StoredSecret {
  return {
    get: async () => (await (await secretsDb()).get(STORE, name)) as string | undefined,
    store: async (value) => { await (await secretsDb()).put(STORE, value, name); },
    delete: async () => { await (await secretsDb()).delete(STORE, name); },
  };
}

// Cloudflare rotates the refresh token on every refresh, so every extension page queues on one exclusive lock;
// core re-reads the tokens once it holds it.
const refreshLock: StoredLock = {
  run: (task) => navigator.locks.request("labshelf:relay-account:refresh", { mode: "exclusive" }, task),
};

export function openBrowserRelayAccountStore(logger: ILogger): RelayAccountStore {
  return createRelayAccountStore({ account: createRelayAccountSlot("account"), tokens: createRelayAccountSlot("tokens"), refreshLock }, logger);
}
