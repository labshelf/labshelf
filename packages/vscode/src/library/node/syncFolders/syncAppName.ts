// Names a detected sync tool the way its own app does.
import type { SyncFolderTool } from "@labshelf/core/node";

const NAMES: Record<SyncFolderTool, string> = {
  dropbox: "Dropbox",
  googledrive: "Google Drive",
  onedrive: "OneDrive",
  icloud: "iCloud Drive",
  nextcloud: "Nextcloud",
  syncthing: "Syncthing",
};

export function syncToolName(tool: SyncFolderTool): string {
  return NAMES[tool];
}
