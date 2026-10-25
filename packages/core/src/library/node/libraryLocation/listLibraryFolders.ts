// Lists the folders a first-run library can live in: one per detected sync folder, then the local one.
import * as path from "node:path";

import type { SyncFolder } from "./detectSyncFolders.js";
import { formatPath } from "./formatPath.js";
import { LIBRARY_FOLDER_NAME } from "./resolveLibraryDir.js";
import { formatSyncTool } from "./formatSyncTool.js";

export interface LibraryFolderChoice {
  path: string;
  /** The path in `~/…` form. */
  label: string;
  /** Which sync tool keeps the folder, or that it stays on this computer. */
  detail: string;
}

export function listLibraryFolders(folders: readonly SyncFolder[], home: string): LibraryFolderChoice[] {
  const synced = folders.map((folder) => {
    const target = path.join(folder.path, LIBRARY_FOLDER_NAME);
    return { path: target, label: formatPath(target, home), detail: `synced by ${formatSyncTool(folder.tool)}` };
  });
  const local = path.join(home, LIBRARY_FOLDER_NAME);
  return [...synced, { path: local, label: formatPath(local, home), detail: "only on this computer" }];
}
