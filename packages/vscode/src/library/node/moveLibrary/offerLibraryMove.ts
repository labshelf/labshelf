// Offers to move a local-only library into a sync folder that appeared on this computer.
import * as os from "node:os";
import * as vscode from "vscode";

import { detectSyncFolders, inspectLibraryFolder, loadSharedConfig, updateSharedConfig } from "@labshelf/core/node";
import type { LibraryRootController } from "../../../activation/libraryLifecycle/index.js";
import { displayPath, syncToolName } from "../syncFolders/index.js";
import { moveLibraryTo } from "./moveLibraryTo.js";
import { moveOfferTarget, pickMoveOffer } from "./pickMoveOffer.js";

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
