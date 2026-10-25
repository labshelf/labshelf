// Hands out the relay Worker script that an app bundle embeds.

// INVARIANT: each app bundle that deploys defines this from core/tools/relayWorker/bundleRelayWorker.mjs. It is read only
// inside the function, so a bundle that does not define it loads safely as long as it never calls it.
declare const RELAY_WORKER_SCRIPT: string;

export const readRelayWorkerScript = (): string => RELAY_WORKER_SCRIPT;
