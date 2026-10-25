// Uploads the bundled Worker over an older deployed one, and never over an equal or newer one.
import type { ILogger } from "../../ports/index.js";
import { createCloudflareClient } from "./cloudflareClient.js";
import { compareWorkerBuilds, fetchWorkerBuild, formatWorkerBuild, parseWorkerBuild } from "./workerBuild.js";
import { uploadWorker } from "./workerUpload.js";

export interface UpdateRelayOptions {
  relayUrl: string;
  /** The `<major>.<minor>.<patch>` build of the bundled script. */
  bundledVersion: string;
  /** Asked only when the relay needs the update, so a current relay costs no token refresh. */
  accessToken(): Promise<string>;
  accountId: string;
  script: string;
  workerName: string;
  kvNamespaceId: string;
  logger: ILogger;
  fetch: typeof fetch;
}

export type RelayUpdateOutcome = "updated" | "current" | "deployedNewer";

/** Reads the public /version first, so a current relay costs no API call. */
export async function updateRelayIfOlder(options: UpdateRelayOptions): Promise<RelayUpdateOutcome> {
  const { relayUrl, bundledVersion, logger } = options;
  const bundled = parseWorkerBuild(bundledVersion);
  if (!bundled) { throw new Error(`The bundled relay version "${bundledVersion}" is not major.minor.patch.`); }
  const deployed = await fetchWorkerBuild(relayUrl, options.fetch, logger);
  const order = compareWorkerBuilds(deployed, bundled);
  const versions = { relayUrl, deployed: formatWorkerBuild(deployed), bundled: bundledVersion };
  if (order > 0) {
    await logger.log("INFO", "relay.deploy", "Deployed relay is newer than the bundled one; leaving it", versions);
    return "deployedNewer";
  }
  if (order === 0) { return "current"; }
  await logger.log("INFO", "relay.deploy", "Updating relay", versions);
  const client = createCloudflareClient({ token: await options.accessToken(), fetch: options.fetch, logger });
  const { accountId, workerName, script, kvNamespaceId } = options;
  await uploadWorker(client, { accountId, workerName, script, kvNamespaceId, withMigrations: false });
  return "updated";
}
