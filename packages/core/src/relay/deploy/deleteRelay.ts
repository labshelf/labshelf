// Removes the relay Worker, and its KV namespace from the owner's account.
import type { ILogger } from "../../ports/index.js";
import { CloudflareApiError, createCloudflareClient } from "./api/index.js";

export interface DeleteRelayOptions {
  token: string;
  accountId: string;
  workerName: string;
  kvNamespaceId: string;
  logger: ILogger;
  fetch: typeof fetch;
}

/** Tries both deletions, treats a missing resource as deleted and throws the first other failure afterwards. */
export async function deleteRelay(options: DeleteRelayOptions): Promise<void> {
  const { accountId, workerName, kvNamespaceId, logger } = options;
  const client = createCloudflareClient({ token: options.token, fetch: options.fetch, logger });
  const account = `/accounts/${accountId}`;
  await logger.log("INFO", "relay.deploy", "Deleting relay", { accountId, workerName });
  const steps = [
    () => client.call("DELETE", `${account}/workers/scripts/${workerName}?force=true`),
    () => client.call("DELETE", `${account}/storage/kv/namespaces/${kvNamespaceId}`),
  ];
  let firstFailure: unknown;
  for (const step of steps) {
    try {
      await step();
    } catch (error) {
      if (error instanceof CloudflareApiError && error.status === 404) { continue; }
      firstFailure ??= error;
    }
  }
  if (firstFailure !== undefined) { throw firstFailure; }
  await logger.log("INFO", "relay.deploy", "Relay deleted", { workerName });
}
