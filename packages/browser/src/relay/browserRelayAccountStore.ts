// Opens the relay account store on the extension's IndexedDB slots, refreshing tokens under a Web Lock.
import { createRelayAccountStore, type ILogger, type RelayAccountStore, type StoredLock } from "@labshelf/core";
import { relayAccountSlot } from "./relayAccountSecrets";

// Cloudflare rotates the refresh token on every refresh, so every extension page queues on one exclusive lock;
// core re-reads the tokens once it holds it.
const refreshLock: StoredLock = {
  run: (task) => navigator.locks.request("labshelf:relay-account:refresh", { mode: "exclusive" }, task),
};

export function openBrowserRelayAccountStore(logger: ILogger): RelayAccountStore {
  return createRelayAccountStore({ account: relayAccountSlot("account"), tokens: relayAccountSlot("tokens"), refreshLock }, logger);
}
