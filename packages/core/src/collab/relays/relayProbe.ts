// Asks a relay's public /version whether it serves a compatible protocol, giving up after 3 s.
import type { ILogger } from "../../ports/index.js";
import { decodeVersionResponse, RELAY_PATH } from "../../relay/index.js";
import { systemScheduler, type SessionScheduler } from "../sync/index.js";

export const PROBE_TIMEOUT_MS = 3000;
const LOG_MODULE = "collab.relays";

export interface RelayProbeOptions {
  logger: ILogger;
  fetch?: typeof fetch;
  scheduler?: SessionScheduler;
}

// CONTRACT: documents/contracts/collaboration.md#relay-list
export function relayProbe({ logger, fetch: doFetch = fetch, scheduler = systemScheduler }: RelayProbeOptions): (relayUrl: string) => Promise<boolean> {
  return async (relayUrl) => {
    const url = `${relayUrl.replace(/\/+$/, "")}${RELAY_PATH.version}`;
    const controller = new AbortController();
    let cancel = () => {};
    const timeout = new Promise<string>((resolve) => {
      cancel = scheduler.after(PROBE_TIMEOUT_MS, () => { controller.abort(); resolve(`no answer within ${PROBE_TIMEOUT_MS} ms`); });
    });
    const ask = (async () => {
      const response = await doFetch(url, { method: "GET", signal: controller.signal });
      const decoded = decodeVersionResponse(await response.json());
      if (!response.ok || !decoded.ok) { return decoded.ok ? `status ${response.status}` : decoded.error; }
      return "";
    })().catch((error: unknown) => String(error));
    const problem = await Promise.race([ask, timeout]).finally(() => cancel());
    if (problem) { void logger.log("WARN", LOG_MODULE, "A relay did not answer /version", { url, problem }); }
    return problem === "";
  };
}
