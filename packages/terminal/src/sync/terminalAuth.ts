/** The terminal's Google sign-in: its OAuth client (environment, then the credentials bundled at build time) and its wording. */
import { resolveOAuthClient, type FetchFn, type ILogger, type OAuthClient, type TokenStore } from "@labshelf/core";
import { PkceLoopbackAuth, type LoginPrompt } from "@labshelf/core/node";

import { CLIENT_ID, CLIENT_SECRET } from "./googleDriveCredentials.js";

/** @returns the OAuth client, or undefined when none is configured */
export function resolveTerminalOAuthClient(env: NodeJS.ProcessEnv = process.env): OAuthClient | undefined {
  return resolveOAuthClient(env, { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET });
}

/**
 * @param prompt how the sign-in reaches the user; individual logins may override it
 * @returns the Drive auth of the terminal app
 */
export function createTerminalAuth(
  client: OAuthClient | undefined,
  store: TokenStore,
  logger: ILogger,
  prompt: LoginPrompt,
  fetchImpl: FetchFn = fetch,
): PkceLoopbackAuth {
  return new PkceLoopbackAuth(client, store, fetchImpl, {
    ...prompt,
    logger,
    signInHint: "Run `labshelf auth login` to sign in.",
    successMessage: "LabShelf is connected to Google Drive. You can close this tab and return to the terminal.",
  });
}
