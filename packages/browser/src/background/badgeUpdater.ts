// Reflects sync state on the toolbar action badge: none, idle dot, spinner or "!".
// Polls about once a second.
import { COLOR_TOKENS } from "@labshelf/core";
import { bx, type SyncStatusData } from "../platform";

// Polling shows transient sync flips without bespoke event plumbing.
const POLL_MS = 1000;
// ASCII-only spinner frames (project rule: no emoji in UI text).
const SPINNER_FRAMES = [".  ", ".. ", "...", " ..", "  ."];
// The toolbar has no theme, so the badge uses the dark values of the core tokens.
const COLOR_SYNC = COLOR_TOKENS.blue.value;
const COLOR_ERROR = COLOR_TOKENS.error.value;

/** Provided by background/index so the badge tracks the live controller. */
export type GetSyncStatus = () => SyncStatusData;

/**
 * Starts the polling loop. Has no teardown — the MV3 service worker handles
 * lifecycle by suspending the entire context when idle.
 */
export function installBadgeUpdater(getStatus: GetSyncStatus): void {
  let frame = 0;
  let lastSignature = "";

  const tick = (): void => {
    const status = getStatus();
    if (status.syncing) {
      const text = SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? ".";
      void bx.action.setBadgeBackgroundColor({ color: COLOR_SYNC });
      void bx.action.setBadgeText({ text });
      void bx.action.setTitle({ title: "LabShelf — Syncing…" });
      frame += 1;
      lastSignature = "syncing";
      return;
    }
    const sig = signature(status);
    if (sig === lastSignature) return;
    lastSignature = sig;
    if (status.lastError) {
      void bx.action.setBadgeBackgroundColor({ color: COLOR_ERROR });
      void bx.action.setBadgeText({ text: "!" });
      void bx.action.setTitle({ title: `LabShelf — ${status.lastError}` });
      return;
    }
    if (status.connected) {
      void bx.action.setBadgeText({ text: "" });
      const when = status.lastSyncTime
        ? new Date(status.lastSyncTime).toLocaleTimeString()
        : "never";
      void bx.action.setTitle({ title: `LabShelf — last sync ${when}` });
      return;
    }
    void bx.action.setBadgeText({ text: "" });
    void bx.action.setTitle({ title: "LabShelf — disconnected" });
  };

  setInterval(tick, POLL_MS);
  tick();
}

function signature(s: SyncStatusData): string {
  return [s.connected, s.syncing, s.lastError ?? "", s.lastSyncTime ?? ""].join("|");
}
