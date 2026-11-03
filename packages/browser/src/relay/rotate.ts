// The hourly relay check while a share is open: retires a rotated-out relay once due, and rotates a relay that heavy traffic or Cloudflare's limit page calls for.
import { createCloudflareAbuseSignal, createRelayProbe, readRelayWorkerScript, rotateRelayOnAbuse, type ILogger, type RelayClock } from "@labshelf/core";
import { createBackgroundRelayDeps, relayUpdateLock, retireOwnRelayIfDue, updateRegistrationsAfterRotation } from "./account";

const LOG_MODULE = "relay";

export const RELAY_CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface RelayCheckOptions {
  logger: ILogger;
  fetch?: typeof fetch;
  clock?: RelayClock;
  /** True while this page runs a share; the abuse check is skipped otherwise. */
  hasOpenShare(): boolean;
  /** Offers the relay to the shares of this page. */
  offerToShares(): Promise<void>;
  /** Takes the relay out of the shares of this page. */
  withdrawFromShares(relayUrl: string): Promise<void>;
}

/**
 * One tick: retires a rotated-out relay whose grace period has passed (also with no share open, it only deletes), then, while a share
 * is open, rotates when D13 calls for it. Failures are logged, never thrown.
 */
export async function checkRelayOnce(options: RelayCheckOptions): Promise<void> {
  const { logger } = options;
  await retireOwnRelayIfDue(logger, options);
  if (!options.hasOpenShare()) { return; }
  try {
    const deps = createBackgroundRelayDeps(logger, options);
    const account = await deps.store.get();
    if (!account) { return; }
    const verdict = await createRelayProbe({ logger, fetch: deps.fetch })(account.relayUrl);
    await rotateRelayOnAbuse({
      ...deps, withLock: relayUpdateLock, script: readRelayWorkerScript(),
      offerToShares: options.offerToShares, withdrawFromShares: options.withdrawFromShares,
      updateRegistration: updateRegistrationsAfterRotation,
      signal: createCloudflareAbuseSignal(deps), limitRefused: verdict === "limit",
    });
  } catch (error) {
    await logger.error(LOG_MODULE, error, { step: "check the relay for abuse" });
  }
}

/** Runs `checkRelayOnce` every hour, one at a time; the returned function stops it (call it on pagehide). */
export function startRelayChecks(options: RelayCheckOptions): () => void {
  let running = false;
  const handle = setInterval(() => {
    if (running) { return; }
    running = true;
    void checkRelayOnce(options).finally(() => { running = false; });
  }, RELAY_CHECK_INTERVAL_MS);
  return () => { clearInterval(handle); };
}
