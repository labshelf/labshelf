/** Words the Google Drive connection state once, for every app that shows it. */
import { formatDateTime } from "../../library/format/index.js";

export interface DriveStatus {
  connected: boolean;
  syncing: boolean;
  /** ISO time of the last successful sync of this library. */
  lastSyncTime: string | null;
  lastError: string | null;
}

export function driveStatusText(status: DriveStatus): string {
  if (status.syncing) { return "Syncing…"; }
  if (!status.connected) { return "Not connected to Google Drive"; }
  const when = formatDateTime(status.lastSyncTime ?? undefined);
  return when ? `Connected — last sync ${when}` : "Connected to Google Drive";
}
