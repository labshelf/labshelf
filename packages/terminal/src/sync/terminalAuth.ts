/** Builds the terminal's Drive auth. */
import type { FetchFn, ILogger, OAuthClient, TokenStore } from "@labshelf/core";
import { PkceLoopbackAuth, type LoginPrompt } from "@labshelf/core/node";

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
