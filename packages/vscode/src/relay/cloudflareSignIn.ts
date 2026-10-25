// Signs the owner in to Cloudflare in the browser and stores the tokens it grants in SecretStorage.
import * as vscode from "vscode";

import { exchangeAuthorizationCode, readAuthorizationCode, startCloudflareAuthorization, storeCloudflareTokens } from "@labshelf/core";
import type { RelayDeps } from "./connectRelay.js";
import { LOG_MODULE } from "./relayAccounts.js";
import { listenForCallback } from "./oauthCallback.js";

/** Throws `LoopbackUnavailableError` before opening the browser when the redirect port cannot be used. */
export async function signInToCloudflare(deps: RelayDeps): Promise<void> {
  const { accounts, logger } = deps;
  const authorization = await startCloudflareAuthorization();
  const progress = { location: vscode.ProgressLocation.Notification, title: "Sign in to Cloudflare in your browser", cancellable: true };
  await vscode.window.withProgress(progress, async (_progress, cancel) => {
    const callback = await listenForCallback({
      cancel,
      handle: async (callbackUrl) => {
        const code = readAuthorizationCode(callbackUrl, authorization.state);
        const tokens = await exchangeAuthorizationCode({ code, verifier: authorization.verifier, fetch: globalThis.fetch, logger, now: () => Date.now() });
        await storeCloudflareTokens(accounts.tokens, tokens);
      },
    });
    const consentUrl = vscode.Uri.parse(authorization.url);
    if (!(await vscode.env.openExternal(consentUrl))) {
      await logger.log("WARN", LOG_MODULE, "The browser did not open for the Cloudflare sign-in");
      callback.close();
    }
    await callback.done;
  });
  await logger.log("INFO", LOG_MODULE, "Signed in to Cloudflare");
}
