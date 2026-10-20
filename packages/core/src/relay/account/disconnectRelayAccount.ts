// Disconnects Cloudflare: takes the owner's relay out of the shares, deletes it from the account and forgets its credential.
import { deleteRelay } from "../deploy/index.js";
import { accountAccessToken, type RelayAccountDeps } from "./accountAccessToken.js";
import { RELAY_ACCOUNT_LOG_MODULE, RELAY_WORKER_NAME } from "./relayAccount.js";

export interface DisconnectRelayAccountDeps extends RelayAccountDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
  progress?(step: "deleting"): void;
}

/** Resolves undefined when no account is connected. */
export async function disconnectRelayAccount(deps: DisconnectRelayAccountDeps): Promise<{ accountId: string; relayUrl: string } | undefined> {
  const account = await deps.store.get();
  if (!account) { return undefined; }
  const { credential, accountId, kvNamespaceId, relayUrl } = account;
  // Asked before the withdrawal, so a refused sign-in leaves the shares as they are.
  const token = await accountAccessToken(deps, credential)();
  // Withdrawn first, so collaborators move to the next relay before this one stops answering.
  await deps.withdrawFromShares(relayUrl);
  deps.progress?.("deleting");
  await deleteRelay({ token, accountId, workerName: RELAY_WORKER_NAME, kvNamespaceId, logger: deps.logger, fetch: deps.fetch });
  // CONTRACT: documents/contracts/relay.md#owner-account
  await deps.store.forget();
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Disconnected Cloudflare", { accountId, relayUrl });
  return { accountId, relayUrl };
}
