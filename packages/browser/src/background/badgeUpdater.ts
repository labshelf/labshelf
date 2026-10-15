// Reflects sync state on the toolbar action badge: none, an animated spinner while syncing, or "!" on an error.
import { COLOR_TOKENS, type DriveStatus } from "@labshelf/core";
import { bx } from "../platform";

const SPIN_MS = 1000;
// ASCII-only spinner frames (project rule: no emoji in UI text).
const SPINNER_FRAMES = [".  ", ".. ", "...", " ..", "  ."];
// The toolbar has no theme, so the badge uses the dark values of the core tokens.
const COLOR_SYNC = COLOR_TOKENS.blue.value;
const COLOR_ERROR = COLOR_TOKENS.error.value;

/** Provided by background/index so the badge tracks the live controller. */
export type GetSyncStatus = () => DriveStatus;

/**
 * Paints the badge now and again on every status change of the coordinator. Has no teardown — the MV3 service worker
 * handles lifecycle by suspending the entire context when idle.
 */
export function installBadgeUpdater(getStatus: GetSyncStatus, onStatus: (listener: () => void) => unknown): void {
  let lastSignature = "";
  let frame = 0;
  // Runs only while the coordinator reports "syncing".
  let spinner: ReturnType<typeof setInterval> | undefined;

  const spin = (): void => {
    void bx.action.setBadgeBackgroundColor({ color: COLOR_SYNC });
    void bx.action.setBadgeText({ text: SPINNER_FRAMES[frame % SPINNER_FRAMES.length] ?? "." });
    void bx.action.setTitle({ title: "LabShelf — Syncing…" });
    frame += 1;
  };

  const paint = (): void => {
    const status = getStatus();
    if (status.syncing) {
      if (spinner !== undefined) return;
      lastSignature = "syncing";
      spin();
      spinner = setInterval(spin, SPIN_MS);
      return;
    }
    clearInterval(spinner);
    spinner = undefined;
    frame = 0;
    const sig = signature(status);
    if (sig === lastSignature) return;
    lastSignature = sig;
    if (status.lastError) {
      void bx.action.setBadgeBackgroundColor({ color: COLOR_ERROR });
      void bx.action.setBadgeText({ text: "!" });
      void bx.action.setTitle({ title: `LabShelf — ${status.lastError}` });
      return;
    }
    void bx.action.setBadgeText({ text: "" });
    if (status.connected) {
      const when = status.lastSyncTime ? new Date(status.lastSyncTime).toLocaleTimeString() : "never";
      void bx.action.setTitle({ title: `LabShelf — last sync ${when}` });
      return;
    }
    void bx.action.setTitle({ title: "LabShelf — disconnected" });
  };

  onStatus(paint);
  paint();
}

function signature(s: DriveStatus): string {
  return [s.connected, s.syncing, s.lastError ?? "", s.lastSyncTime ?? ""].join("|");
}
