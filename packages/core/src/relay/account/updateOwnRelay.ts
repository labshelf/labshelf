// Brings the owner's deployed relay up to the Worker build this LabShelf bundles.
import { RELAY_WORKER_BUILD } from "../protocolVersion.js";
import { updateRelayIfOlder, type RelayUpdateOutcome } from "../deploy/index.js";
import { accountAccessToken, type RelayAccountDeps } from "./accountAccessToken.js";
import { RELAY_ACCOUNT_LOG_MODULE, RELAY_WORKER_NAME } from "./relayAccount.js";

/** Resolves undefined when no account is connected. */
export async function updateOwnRelay(deps: RelayAccountDeps & { script: string }): Promise<RelayUpdateOutcome | undefined> {
  const account = await deps.store.get();
  if (!account) { return undefined; }
  const { relayUrl, credential, accountId, kvNamespaceId } = account;
  const outcome = await updateRelayIfOlder({
    relayUrl, bundledVersion: RELAY_WORKER_BUILD, accessToken: accountAccessToken(deps, credential), accountId, script: deps.script,
    workerName: RELAY_WORKER_NAME, kvNamespaceId, logger: deps.logger, fetch: deps.fetch,
  });
  await deps.logger.log("INFO", RELAY_ACCOUNT_LOG_MODULE, "Checked the relay version", { relayUrl, outcome });
  return outcome;
}
