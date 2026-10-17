// Builds the numbered choices the first-run prompt offers for where the library lives.
import * as path from "node:path";

import type { SyncFolder, SyncFolderTool } from "@labshelf/core/node";

import { LIBRARY_FOLDER_NAME } from "./libraryTarget.js";

export type FirstRunChoice =
  | { kind: "folder"; label: string; detail: string; path: string }
  | { kind: "custom"; label: string }
  | { kind: "guide"; label: string };

const TOOL_NAMES: Record<SyncFolderTool, string> = {
  dropbox: "Dropbox", googledrive: "Google Drive", onedrive: "OneDrive", icloud: "iCloud Drive", nextcloud: "Nextcloud", syncthing: "Syncthing",
};

function shown(target: string, home: string): string {
  return target.startsWith(home + path.sep) ? `~${target.slice(home.length)}` : target;
}

/** @returns one choice per detected sync folder, the local folder, a typed path and the sync guide, in that order */
export function firstRunChoices(folders: readonly SyncFolder[], home: string): FirstRunChoice[] {
  const synced = folders.map((folder): FirstRunChoice => {
    const target = path.join(folder.path, LIBRARY_FOLDER_NAME);
    return { kind: "folder", label: shown(target, home), detail: `synced by ${TOOL_NAMES[folder.tool]}`, path: target };
  });
  const local = path.join(home, LIBRARY_FOLDER_NAME);
  return [
    ...synced,
    { kind: "folder", label: shown(local, home), detail: "only on this computer", path: local },
    { kind: "custom", label: "Choose a folder…" },
    { kind: "guide", label: "How to sync between computers" },
  ];
}
