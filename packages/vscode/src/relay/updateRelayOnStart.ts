// Brings the owner's deployed relay up to the Worker build this LabShelf bundles, once per start.
import { RELAY_WORKER_BUILD, updateRelayIfOlder } from "@labshelf/core";
import type { RelayDeps } from "./connectRelay.js";
import { LOG_MODULE, RELAY_WORKER_NAME } from "./relayAccounts.js";
import { reportRelayFailure } from "./relayFailure.js";
import { relayWorkerScript } from "./relayWorkerScript.js";
import { accountAccessToken } from "./signIn/index.js";

export async function updateRelayOnStart(deps: RelayDeps): Promise<void> {
  const account = await deps.accounts.get();
  if (!account) { return; }
  try {
    const { relayUrl, credential, accountId, kvNamespaceId } = account;
    const outcome = await updateRelayIfOlder({
      relayUrl, bundledVersion: RELAY_WORKER_BUILD, accessToken: accountAccessToken(deps, credential), accountId, script: relayWorkerScript(), workerName: RELAY_WORKER_NAME, kvNamespaceId,
      logger: deps.logger, fetch: globalThis.fetch,
    });
    void deps.logger.log("INFO", LOG_MODULE, "Checked the relay version", { relayUrl, outcome });
  } catch (error) {
    reportRelayFailure(deps.logger, "update your relay", error);
  }
}
