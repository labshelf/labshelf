// Offers to move a local-only library into a sync folder that appeared on this computer.
import * as os from "node:os";
import * as vscode from "vscode";

import {
  detectSyncFolders,
  inspectLibraryFolder,
  loadSharedConfig,
  updateSharedConfig,
  type SyncFolder,
} from "@labshelf/core/node";
import type { LibraryRootController } from "../../activation/index.js";
import { displayPath, syncToolName, LIBRARY_FOLDER_NAME } from "./syncFolders/index.js";
import { moveLibraryTo } from "./moveLibraryTo.js";
import * as path from "node:path";

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function moveOfferTarget(folder: SyncFolder): string {
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

async function readDismissed(): Promise<string[]> {
  const namespace = (await loadSharedConfig()).vscode;
  const list = (namespace as { dismissedMoveOffers?: unknown } | undefined)?.dismissedMoveOffers;
  return Array.isArray(list) ? list.filter((tool): tool is string => typeof tool === "string") : [];
}

// Arrays in the shared config are replaced, so the whole list is written back.
async function dismiss(tool: string): Promise<void> {
  const dismissed = await readDismissed();
  await updateSharedConfig({ vscode: { dismissedMoveOffers: [...dismissed, tool] } });
}

export async function offerLibraryMove(controller: LibraryRootController): Promise<void> {
  const root = controller.currentRoot();
  const services = controller.currentServices();
  if (!root || !services) { return; }
  const home = os.homedir();
  const detected = await detectSyncFolders({ home, env: process.env, platform: process.platform, logger: services.logger });
  const existing = new Set<string>();
  for (const folder of detected) {
    if ((await inspectLibraryFolder(moveOfferTarget(folder))).exists) { existing.add(moveOfferTarget(folder)); }
  }
  const offer = pickMoveOffer(root.fsPath, detected, await readDismissed(), existing);
  if (!offer) { return; }

  const target = moveOfferTarget(offer);
  const answer = await vscode.window.showInformationMessage(
    `LabShelf: Found ${syncToolName(offer.tool)}. Move the library to ${displayPath(target, home)}?`, "Move", "Not now",
  );
  if (answer === "Move") { await moveLibraryTo(controller, target); }
  if (answer === "Not now") {
    await dismiss(offer.tool);
    await services.logger.log("INFO", "libraryMove", "Move offer dismissed", { tool: offer.tool });
  }
}
