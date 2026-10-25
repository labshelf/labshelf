// Polls a relay's /version with growing delays until its address answers.
import type { ILogger } from "../../ports/index.js";
import { fetchWorkerBuild } from "./workerBuild.js";

export interface RelayClock { now(): number; sleep(ms: number): Promise<void> }

export interface WaitForRelayOptions {
  relayUrl: string;
  fetch: typeof fetch;
  logger: ILogger;
  clock: RelayClock;
  /** Gives up after this long; a new account subdomain needs 90 to 130 s before TLS answers. */
  timeoutMs?: number;
}

const FIRST_DELAY_MS = 5_000;
const MAX_DELAY_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 240_000;

/** Resolves when `/version` answers; throws when the timeout passes. Each failed poll is logged by `fetchWorkerBuild`. */
export async function assertRelayServing({ relayUrl, fetch: doFetch, logger, clock, timeoutMs = DEFAULT_TIMEOUT_MS }: WaitForRelayOptions): Promise<void> {
  const deadline = clock.now() + timeoutMs;
  let delay = FIRST_DELAY_MS;
  for (;;) {
    try {
      await fetchWorkerBuild(relayUrl, doFetch, logger);
      await logger.log("INFO", "relay.deploy", "Relay is serving", { relayUrl });
      return;
    } catch (error) {
      if (clock.now() + delay > deadline) {
        throw new Error(`The relay at ${relayUrl} did not answer within ${Math.round(timeoutMs / 1000)} s.`, { cause: error });
      }
    }
    await clock.sleep(delay);
    delay = Math.min(delay * 1.5, MAX_DELAY_MS);
  }
}
