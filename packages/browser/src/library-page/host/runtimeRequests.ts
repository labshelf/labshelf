/** Nudges the background to coalesce a sync after a local change; the page does not wait and logs a request that failed. */
import { errorMessage, type ILogger } from "@labshelf/core";
import { sendRuntime } from "../../platform";

export function scheduleSyncSoon(log: ILogger, reason: string): void {
  void sendRuntime({ type: "sync.scheduleSoon", reason }).catch((error: unknown) =>
    log.log("WARN", "library-page", "Sync request was not accepted", { reason, message: errorMessage(error) }),
  );
}
