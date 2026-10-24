// Asks a relay's public /version whether it serves a compatible protocol, refuses for limits or fails, giving up after 3 s.
import type { ILogger } from "../../ports/index.js";
import { decodeVersionResponse, RELAY_PATH } from "../../relay/index.js";
import { systemScheduler, type SessionScheduler } from "../peer/index.js";
import { isLimitRefusal } from "./observedConnection.js";

export const PROBE_TIMEOUT_MS = 3000;
const LOG_MODULE = "collab.relays";

/** `limit` is a 429 or Cloudflare's 1027 page; `error` is any other failure, including silence and another major. */
export type RelayVerdict = "ok" | "limit" | "error";

export interface RelayProbeOptions {
  logger: ILogger;
  fetch?: typeof fetch;
  scheduler?: SessionScheduler;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function relayProbe({ logger, fetch: doFetch = fetch, scheduler = systemScheduler }: RelayProbeOptions): (relayUrl: string) => Promise<RelayVerdict> {
  return async (relayUrl) => {
    const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
    const controller = new AbortController();
    let cancel = () => {};
    const timeout = new Promise<Problem>((resolve) => {
      cancel = scheduler.after(PROBE_TIMEOUT_MS, () => { controller.abort(); resolve(["error", `no answer within ${PROBE_TIMEOUT_MS} ms`]); });
    });
    const ask = (async (): Promise<Problem | undefined> => {
      const response = await doFetch(url, { method: "GET", signal: controller.signal });
      // INVARIANT: the limit check runs before parsing, because the 1027 page is HTML.
      if (await isLimitRefusal(response)) { return ["limit", `status ${response.status}`]; }
      const decoded = decodeVersionResponse(await response.json());
      if (!response.ok || !decoded.ok) { return ["error", decoded.ok ? `status ${response.status}` : decoded.error]; }
      return undefined;
    })().catch((error: unknown): Problem => ["error", String(error)]);
    const problem = await Promise.race([ask, timeout]).finally(() => cancel());
    if (!problem) { return "ok"; }
    void logger.log("WARN", LOG_MODULE, "A relay did not answer /version", { url, verdict: problem[0], problem: problem[1] });
    return problem[0];
  };
}

type Problem = [verdict: Exclude<RelayVerdict, "ok">, detail: string];
