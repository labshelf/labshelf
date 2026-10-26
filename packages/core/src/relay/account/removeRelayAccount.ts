// Disconnects Cloudflare: takes the owner's relay out of the shares, deletes it from the account and forgets its credential.
import { removeRelay } from "../client/index.js";
import { createAccessTokenReader, type RelayAccountDeps } from "./createAccessTokenReader.js";
import { RELAY_ACCOUNT_LOG_MODULE, RELAY_WORKER_NAME } from "./relayAccount.js";

export interface DisconnectRelayAccountDeps extends RelayAccountDeps {
  /** Takes the relay out of the relay lists and stored invites of the shared projects on this device. */
  withdrawFromShares(relayUrl: string): Promise<void>;
  progress?(step: "deleting"): void;
}

/** Resolves undefined when no account is connected. */
export async function removeRelayAccount(deps: DisconnectRelayAccountDeps): Promise<{ accountId: string; relayUrl: string } | undefined> {
  const account = await deps.store.get();
  if (!account) { return undefined; }
  const { credential, accountId, kvNamespaceId, relayUrl } = account;
  // Asked before the withdrawal, so a refused sign-in leaves the shares as they are.
  const token = await createAccessTokenReader(deps, credential)();
  // Withdrawn first, so collaborators move to the next relay before this one stops answering.
  await deps.withdrawFromShares(relayUrl);
  deps.progress?.("deleting");
  await removeRelay({ token, accountId, workerName: RELAY_WORKER_NAME, kvNamespaceId, logger: deps.logger, fetch: deps.fetch });
  // CONTRACT: documents/contracts/relay.md#deploy
  await deps.store.forget();
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Disconnected Cloudflare", { accountId, relayUrl });
  return { accountId, relayUrl };
}
