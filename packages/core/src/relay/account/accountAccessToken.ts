// Gives the access token of the connected Cloudflare account, asking the owner to sign in again when Cloudflare refuses it.
import type { ILogger } from "../../ports/index.js";
import { CloudflareOAuthError, createCloudflareSession, type RelayClock } from "../deploy/index.js";
import { RELAY_ACCOUNT_LOG_MODULE, type RelayCredential } from "./relayAccount.js";
import type { RelayAccountStore } from "./relayAccountStore.js";

export interface RelayAccountDeps {
  store: RelayAccountStore;
  fetch: typeof fetch;
  logger: ILogger;
  clock: RelayClock;
  /** Asks the owner and, on yes, runs a new sign-in that stores fresh tokens; resolves whether it did. */
  signInAgain(refused: CloudflareOAuthError): Promise<boolean>;
}

/** The codes after which only a new sign-in helps. */
const SIGN_IN_AGAIN_CODES = new Set(["invalid_grant", "not_signed_in"]);

/** Each call reads the stored tokens again, so a token refreshed by another window is used. */
export function accountAccessToken(deps: RelayAccountDeps, credential: RelayCredential): () => Promise<string> {
  if (credential.kind === "token") { return async () => credential.token; }
  const { store, logger, clock } = deps;
  const session = createCloudflareSession({ tokens: store.tokens, lock: store.refreshLock, fetch: deps.fetch, logger, clock });
  return async () => {
    try {
      return await session.accessToken();
    } catch (error) {
      if (!(error instanceof CloudflareOAuthError) || !SIGN_IN_AGAIN_CODES.has(error.code)) { throw error; }
      await logger.log("WARN", RELAY_ACCOUNT_LOG_MODULE, "Cloudflare refused the stored sign-in; asking the owner to sign in again", {
        code: error.code, error: error.message,
      });
      if (!(await deps.signInAgain(error))) { throw error; }
      return session.accessToken();
    }
  };
}
