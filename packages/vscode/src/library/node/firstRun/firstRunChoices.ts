// Builds the first-run choices: a LabShelf folder in each detected sync folder, one local folder, and two escape hatches.
import * as path from "node:path";

import type { SyncFolder } from "@labshelf/core/node";
import { displayPath, LIBRARY_FOLDER_NAME, syncToolName } from "../syncFolders/index.js";

export type FirstRunChoice =
  | { kind: "folder"; path: string; label: string; detail: string }
  | { kind: "browse"; label: string }
  | { kind: "guide"; label: string };

export function firstRunChoices(detected: readonly SyncFolder[], home: string): FirstRunChoice[] {
  const synced = detected.map((folder): FirstRunChoice => {
    const target = path.join(folder.path, LIBRARY_FOLDER_NAME);
    return { kind: "folder", path: target, label: displayPath(target, home), detail: `synced by ${syncToolName(folder.tool)}` };
  });
  const local = path.join(home, LIBRARY_FOLDER_NAME);
  return [
    ...synced,
    { kind: "folder", path: local, label: displayPath(local, home), detail: "only on this computer" },
    { kind: "browse", label: "Choose a folder…" },
    { kind: "guide", label: "How to sync between computers…" },
  ];
}
