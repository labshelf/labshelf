// Picks the sync folder to offer as a new home for a library that is not in one yet.
import * as path from "node:path";

import type { SyncFolder } from "@labshelf/core/node";
import { LIBRARY_FOLDER_NAME } from "./syncFolders/index.js";

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function moveOfferTarget(folder: SyncFolder): string {
  return path.join(folder.path, LIBRARY_FOLDER_NAME);
}

/**
 * @param existingTargets `<syncFolder>/LabShelf` paths that already exist; moving onto them would mix two libraries
 * @returns the first detected folder worth offering, or undefined when the root is already synced or every tool was dismissed
 */
export function pickMoveOffer(
  root: string,
  detected: readonly SyncFolder[],
  dismissed: readonly string[],
  existingTargets: ReadonlySet<string>,
): SyncFolder | undefined {
  if (detected.some((folder) => isInside(root, folder.path))) { return undefined; }
  return detected.find((folder) => !dismissed.includes(folder.tool) && !existingTargets.has(moveOfferTarget(folder)));
}
