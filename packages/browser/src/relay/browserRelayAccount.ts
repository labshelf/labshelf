// Connects and disconnects the owner's Cloudflare account from an extension page, one page at a time.
import {
  connectRelayAccount, disconnectRelayAccount, relayWorkerScript, systemRelayClock,
  type CloudflareAccount, type ILogger, type RelayAccount, type RelayAccountDeps,
} from "@labshelf/core";
import { openBrowserRelayAccountStore } from "./browserRelayAccountStore";
import { signInInTab } from "./signInInTab";
import { bx } from "../platform";

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
      script: relayWorkerScript(),
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
      const disconnected = await disconnectRelayAccount({ ...deps, withdrawFromShares: options.withdrawFromShares });
      return disconnected && { relayUrl: disconnected.relayUrl };
    }),
  };
}
