// Signs the owner in to Cloudflare in a browser tab, stores the tokens it yields, and waits for the tab to reach the loopback redirect.
// PLATFORM: Cloudflare accepts only the registered loopback redirect, so the page reads the failed navigation's URL
// from tabs.onUpdated; nothing needs to listen on the port, and a VS Code loopback that gets it first rejects it on state.
import {
  CLOUDFLARE_REDIRECT_URI, fetchCloudflareTokens, formatError, readAuthorizationCode, startCloudflareAuthorization, writeCloudflareTokens,
  type ILogger, type RelayAccountStore,
} from "@labshelf/core";
import type { Tabs } from "webextension-polyfill";
import { bx } from "../platform";

const LOG_MODULE = "relay";
const TIMEOUT_MS = 10 * 60_000;
const redirect = new URL(CLOUDFLARE_REDIRECT_URI);

export class RelaySignInCancelledError extends Error {
  override readonly name = "RelaySignInCancelledError";
  constructor() { super("the Cloudflare sign-in was cancelled"); }
}

function isRedirect(url: string | undefined): url is string {
  if (!url || !URL.canParse(url)) { return false; }
  const parsed = new URL(url);
  return parsed.origin === redirect.origin && parsed.pathname === redirect.pathname;
}

/** Resolves with the redirect URL the tab reached; rejects on close, abort or timeout. */
export function watchRedirectTab(tabId: number, logger: ILogger, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const finish = (userClosed: boolean): void => {
      bx.tabs.onUpdated.removeListener(onUpdated);
      bx.tabs.onRemoved.removeListener(onRemoved);
      signal?.removeEventListener("abort", onAbort);
      clearTimeout(timer);
      if (userClosed) { return; }
      bx.tabs.remove(tabId).catch((error: unknown) => logger.log("WARN", LOG_MODULE, "Could not close the Cloudflare sign-in tab", {
        tabId, error: formatError(error),
      }));
    };
    const onUpdated = (id: number, change: Tabs.OnUpdatedChangeInfoType, tab: Tabs.Tab): void => {
      const url = change.url ?? tab.url;
      if (id !== tabId || !isRedirect(url)) { return; }
      finish(false);
      resolve(url);
    };
    const onRemoved = (id: number): void => {
      if (id !== tabId) { return; }
      finish(true);
      reject(new RelaySignInCancelledError());
    };
    const onAbort = (): void => { finish(false); reject(new RelaySignInCancelledError()); };
    const timer = setTimeout(() => {
      finish(false);
      reject(new Error("the Cloudflare sign-in did not come back within 10 minutes"));
    }, TIMEOUT_MS);
    bx.tabs.onUpdated.addListener(onUpdated);
    bx.tabs.onRemoved.addListener(onRemoved);
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export interface SignInInTabOptions {
  store: RelayAccountStore;
  fetch: typeof fetch;
  logger: ILogger;
  signal?: AbortSignal | undefined;
}

export async function signInInTab({ store, fetch, logger, signal }: SignInInTabOptions): Promise<void> {
  // PLATFORM: the verifier and state live only in this closure; a page reload drops them, so the owner starts again.
  const { url, state, verifier } = await startCloudflareAuthorization();
  await logger.log("INFO", LOG_MODULE, "Started the Cloudflare sign-in in a tab");
  try {
    const tab = await bx.tabs.create({ url });
    if (tab.id === undefined) { throw new Error("the browser opened the Cloudflare sign-in tab without an id"); }
    const redirectUrl = await watchRedirectTab(tab.id, logger, signal);
    const code = readAuthorizationCode(redirectUrl, state);
    const tokens = await fetchCloudflareTokens({ code, verifier, fetch, logger, now: Date.now });
    await writeCloudflareTokens(store.tokens, tokens);
    await logger.log("INFO", LOG_MODULE, "Signed in to Cloudflare");
  } catch (error) {
    if (error instanceof RelaySignInCancelledError) {
      await logger.log("INFO", LOG_MODULE, "The Cloudflare sign-in was cancelled");
    } else {
      await logger.error(LOG_MODULE, error, { step: "cloudflare sign-in in a tab" });
    }
    throw error;
  }
}
