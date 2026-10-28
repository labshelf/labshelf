// The browser's relay account: its IndexedDB store under a Web Lock, connect and disconnect from one page at a time, and the start-up update of the owner's relay.
import {
  connectRelayAccount, createRelayAccountStore, readRelayWorkerScript, removeRelayAccount, systemRelayClock, updateOwnRelay,
  type CloudflareAccount, type ILogger, type RelayAccount, type RelayAccountDeps, type RelayAccountStore, type StoredLock, type StoredSecret,
} from "@labshelf/core";
import { openDB, type IDBPDatabase } from "idb";
import { bx } from "../platform";
import { signInInTab } from "./signIn";

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

const LOOPBACK_ORIGINS = ["http://127.0.0.1/*"];

// PLATFORM: Firefox MV3 lets the owner revoke site access; tabs.onUpdated then carries no URL and the redirect is never seen.
// The caller reports the refusal, so it is not logged here.
// TRAP: Firefox drops the user gesture once an await waits on another task, so this runs before any such await after the click.
async function requestLoopbackAccess(): Promise<void> {
  if (await bx.permissions.request({ origins: LOOPBACK_ORIGINS })) { return; }
  throw new Error("LabShelf needs access to 127.0.0.1 to finish signing in to Cloudflare. "
    + "Allow it in the add-on's site access settings and try again.");
}

const LIFECYCLE_LOCK = "labshelf:relay-account:lifecycle";

export class RelayAccountBusyError extends Error {
  override readonly name = "RelayAccountBusyError";
  constructor() { super("another LabShelf page is connecting or disconnecting Cloudflare"); }
}

export interface BrowserRelayAccountOptions {
  logger: ILogger;
  fetch?: typeof fetch;
  /** Asked only when the sign-in reaches more than one account; undefined when the owner cancels. */
  chooseAccount(accounts: CloudflareAccount[]): Promise<string | undefined>;
  offerToShares(): Promise<void>;
  withdrawFromShares(relayUrl: string): Promise<void>;
  /** Asks the owner whether to sign in again after Cloudflare refused the stored sign-in. */
  confirmSignInAgain(): Promise<boolean>;
}

export interface BrowserRelayAccount {
  /** The connected relay's address only, never a secret, so a page may show it. */
  status(): Promise<{ relayUrl: string } | undefined>;
  /** The whole connected account, owner secret included, for the page's own shares; never shown. */
  account(): Promise<RelayAccount | undefined>;
  /** Resolves the relay address, or undefined when the owner cancelled at a choice. */
  connect(): Promise<string | undefined>;
  /** Resolves undefined when no account is connected. */
  disconnect(): Promise<{ relayUrl: string } | undefined>;
}

// INVARIANT: two pages never deploy or delete at once; the second fails fast rather than repeating the first's work.
function exclusively<T>(task: () => Promise<T>): Promise<T> {
  return navigator.locks.request(LIFECYCLE_LOCK, { ifAvailable: true }, async (lock) => {
    if (!lock) { throw new RelayAccountBusyError(); }
    return task();
  });
}

export function createBrowserRelayAccount(options: BrowserRelayAccountOptions): BrowserRelayAccount {
  const { logger } = options;
  const store = openBrowserRelayAccountStore(logger);
  // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome, and core calls it as a method of its deps.
  const fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const deps: RelayAccountDeps = {
    store, fetch, logger, clock: systemRelayClock,
    signInAgain: async () => {
      if (!(await options.confirmSignInAgain())) { return false; }
      await requestLoopbackAccess();
      await signInInTab({ store, fetch, logger });
      return true;
    },
  };
  const connectOnce = async (): Promise<string | undefined> => {
    const existing = await store.get();
    if (existing) { return existing.relayUrl; }
    return connectRelayAccount({
      ...deps,
      // The browser has no pasted-token path: a sign-in tab always reaches the registered loopback redirect.
      chooseCredential: async () => { await signInInTab({ store, fetch, logger }); return { kind: "oauth" }; },
      chooseAccount: options.chooseAccount,
      offerToShares: options.offerToShares,
      script: readRelayWorkerScript(),
    });
  };
  return {
    status: () => store.status(),
    account: () => store.get(),
    // INVARIANT: callers reach connect from the owner's dialog click through microtasks only, so the request keeps the gesture.
    connect: async () => {
      await requestLoopbackAccess();
      return exclusively(connectOnce);
    },
    disconnect: () => exclusively(async () => {
      const disconnected = await removeRelayAccount({ ...deps, withdrawFromShares: options.withdrawFromShares });
      return disconnected && { relayUrl: disconnected.relayUrl };
    }),
  };
}

const LOG_MODULE = "relay";
const UPDATE_LOCK = "labshelf:relay-account:update";

export async function updateOwnRelayOnStart(logger: ILogger): Promise<void> {
  try {
    await navigator.locks.request(UPDATE_LOCK, { ifAvailable: true }, async (lock) => {
      // Another page holds the lock and does the same check.
      if (!lock) { return; }
      await updateOwnRelay({
        store: openBrowserRelayAccountStore(logger),
        // PLATFORM: a detached window.fetch throws "Illegal invocation" in Chrome.
        fetch: (input, init) => globalThis.fetch(input, init),
        logger, clock: systemRelayClock, script: readRelayWorkerScript(),
        // A start-up check never opens a consent tab the owner did not ask for; a refused sign-in surfaces at the next connect or share.
        signInAgain: async () => false,
      });
    });
  } catch (error) {
    await logger.error(LOG_MODULE, error, { step: "update the owner's relay on start" });
  }
}
