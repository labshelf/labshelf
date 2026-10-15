// Fires the sync trigger whenever the browser idle state flips to "idle".
// A minimum gap stops quick lock/unlock cycles from queuing a flurry of syncs.
import type { ILogger } from "@labshelf/core";
import { bx } from "../platform";

/** Starts a sync for the given reason. */
export type SyncTrigger = (reason: string) => void;

const IDLE_DETECTION_SECONDS = 300;
const MIN_GAP_MS = 60_000;

export interface IdleSyncOptions {
  trigger: SyncTrigger;
  logger: ILogger;
}

/**
 * Subscribes to bx.idle transitions and forwards the "idle" state to the sync
 * trigger.
 */
export function installIdleSyncTrigger(opts: IdleSyncOptions): void {
  const { trigger, logger } = opts;
  try {
    bx.idle.setDetectionInterval(IDLE_DETECTION_SECONDS);
  } catch {
    // Some platforms ignore set(); the default detection interval still applies.
  }
  let lastTrigger = 0;
  bx.idle.onStateChanged.addListener((state) => {
    if (state !== "idle") return;
    const now = Date.now();
    if (now - lastTrigger < MIN_GAP_MS) return;
    lastTrigger = now;
    void logger.log("INFO", "idle", "idle transition — scheduling sync");
    trigger("idle");
  });
}
