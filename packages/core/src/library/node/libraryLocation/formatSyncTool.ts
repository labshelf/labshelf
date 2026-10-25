// Names a detected sync tool the way its own app does.
import type { SyncFolderTool } from "./detectSyncFolders.js";

const NAMES: Record<SyncFolderTool, string> = {
  dropbox: "Dropbox",
  googledrive: "Google Drive",
  onedrive: "OneDrive",
  icloud: "iCloud Drive",
  nextcloud: "Nextcloud",
  syncthing: "Syncthing",
};

export function formatSyncTool(tool: SyncFolderTool): string {
  return NAMES[tool];
}
