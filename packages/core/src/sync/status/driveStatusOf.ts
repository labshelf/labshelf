/** Maps the sync coordinator's status plus the sign-in state to the Drive status every app shows. */
import type { SyncStatus } from "../coordinator/index.js";
import type { DriveStatus } from "./driveStatusText.js";

export function driveStatusOf(status: SyncStatus, connected: boolean): DriveStatus {
  return {
    connected,
    syncing: status.state === "syncing",
    lastSyncTime: status.lastRun?.finishedAt ?? null,
    lastError: status.lastError ?? null,
  };
}
