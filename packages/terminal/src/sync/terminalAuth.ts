/** Resolves the terminal's Google OAuth client (environment, then the credentials bundled at build time) and builds its Drive auth. */
import { BUILT_IN_GOOGLE_CLIENT, resolveOAuthClient, type FetchFn, type ILogger, type OAuthClient, type TokenStore } from "@labshelf/core";
import { PkceLoopbackAuth, type LoginPrompt } from "@labshelf/core/node";


/** @returns the OAuth client, or undefined when none is configured */
export function resolveTerminalOAuthClient(env: NodeJS.ProcessEnv = process.env): OAuthClient | undefined {
  return resolveOAuthClient(env, BUILT_IN_GOOGLE_CLIENT);
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
