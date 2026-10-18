/** Exports the deployment of the relay Worker through the Cloudflare API: deploy, update, delete and wait. */
export { CloudflareApiError, createCloudflareClient, listCloudflareAccounts, verifyCloudflareToken, type CloudflareAccount, type CloudflareClient } from "./api/index.js";
export { deleteRelay, type DeleteRelayOptions } from "./deleteRelay.js";
export { deployRelay, type DeployedRelay, type DeployRelayOptions } from "./deployRelay.js";
export { updateRelayIfOlder, type RelayUpdateOutcome, type UpdateRelayOptions } from "./updateRelay.js";
export { waitUntilServing, type RelayClock, type WaitUntilServingOptions } from "./waitUntilServing.js";
export { compareWorkerBuilds, parseWorkerBuild, type WorkerBuild } from "./workerBuild.js";
