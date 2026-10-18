// Gives the access token of the connected Cloudflare account, asking the owner to sign in again when Cloudflare refuses it.
import * as vscode from "vscode";

import { CloudflareOAuthError, createCloudflareSession, createStoredLock } from "@labshelf/core";
import type { RelayDeps } from "../connectRelay.js";
import { relayClock } from "../relayClock.js";
import { LOG_MODULE, type RelayCredential } from "../relayAccounts.js";
import { signInToCloudflare } from "./cloudflareSignIn.js";

/** The codes after which only a new sign-in helps. */
const SIGN_IN_AGAIN_CODES = new Set(["invalid_grant", "not_signed_in"]);

async function askToSignInAgain(deps: RelayDeps, refused: CloudflareOAuthError): Promise<boolean> {
  await deps.logger.log("WARN", LOG_MODULE, "Cloudflare refused the stored sign-in; asking the owner to sign in again", { code: refused.code, error: refused.message });
  const again = "Sign In Again";
  const answer = await vscode.window.showWarningMessage(
    "Cloudflare no longer accepts LabShelf's sign-in. Sign in again so LabShelf can manage your relay.", again,
  );
  return answer === again;
}

/** Each call reads the stored credential state again, so a token refreshed by another window is used. */
export function accountAccessToken(deps: RelayDeps, credential: RelayCredential): () => Promise<string> {
  if (credential.kind === "token") { return async () => credential.token; }
  const session = createCloudflareSession({
    tokens: deps.accounts.oauthTokens, lock: createStoredLock(deps.accounts.refreshLock, relayClock), fetch: globalThis.fetch, logger: deps.logger, clock: relayClock,
  });
  return async () => {
    try {
      return await session.accessToken();
    } catch (error) {
      if (!(error instanceof CloudflareOAuthError) || !SIGN_IN_AGAIN_CODES.has(error.code)) { throw error; }
      if (!(await askToSignInAgain(deps, error))) { throw error; }
      await signInToCloudflare(deps);
      return session.accessToken();
    }
  };
}
