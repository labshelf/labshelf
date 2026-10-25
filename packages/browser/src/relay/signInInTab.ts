// Signs the owner in to Cloudflare in a browser tab and stores the tokens it yields.
import {
  fetchCloudflareTokens, readAuthorizationCode, startCloudflareAuthorization, writeCloudflareTokens,
  type ILogger, type RelayAccountStore,
} from "@labshelf/core";
import { bx } from "../platform";
import { RelaySignInCancelledError, watchRedirectTab } from "./watchRedirectTab";

const LOG_MODULE = "relay";

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
