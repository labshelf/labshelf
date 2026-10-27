// Moves the open library to a new folder: the "Move Library…" command, the progress flow behind it, and the offer to move a local-only library into a sync folder that appeared.
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { formatError, isInside } from "@labshelf/core";
import {
  detectSyncFolders,
  detectLibraryFolder,
  formatPath,
  LIBRARY_FOLDER_NAME,
  loadSharedConfig,
  moveLibrary,
  nodePathOps,
  formatSyncTool,
  resolveLibraryDir,
  updateSharedConfig,
  type SyncFolder,
} from "@labshelf/core/node";
import type { LibraryRootController } from "../../activation/index.js";

/** @returns true when the library now lives at `target` and its services were rebuilt there */
export async function moveLibraryTo(controller: LibraryRootController, target: string): Promise<boolean> {
  const root = controller.currentRoot();
  const services = controller.currentServices();
  if (!root || !services) {
    await vscode.window.showInformationMessage("LabShelf: There is no open library to move.");
    return false;
  }
  const { logger } = services;
  try {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "LabShelf: Moving library…" },
      async (progress) => {
        let reported = 0;
        await moveLibrary(root.fsPath, target, {
          logger,
          env: process.env,
          onProgress: (copied, total) => {
            const percent = Math.floor((copied / total) * 100);
            progress.report({ increment: percent - reported, message: `${copied} of ${total} files` });
            reported = percent;
          },
        });
        await controller.applyRoot(vscode.Uri.file(target));
      },
    );
    return true;
  } catch (error) {
    // moveLibrary logs its own failures; this line also covers rebuilding the services on the new root.
    await logger.error("libraryMove", error, { action: "reopen moved library", target });
    await vscode.window.showErrorMessage(formatError(error));
    return false;
  }
}

export async function runMoveLibraryCommand(controller: LibraryRootController): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: "Move library here",
    title: "LabShelf: Move Library To",
  });
  const picked = folders?.[0];
  if (!picked) { return; }
  const target = await resolveLibraryDir(picked.fsPath);
  if (await moveLibraryTo(controller, target)) {
    vscode.window.showInformationMessage(`LabShelf: Library moved to ${target}`);
  }
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
  if (detected.some((folder) => isInside(nodePathOps, folder.path, root, { allowEqual: true }))) { return undefined; }
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
    if ((await detectLibraryFolder(moveOfferTarget(folder))).exists) { existing.add(moveOfferTarget(folder)); }
  }
  const offer = pickMoveOffer(root.fsPath, detected, await readDismissed(), existing);
  if (!offer) { return; }

  const target = moveOfferTarget(offer);
  const answer = await vscode.window.showInformationMessage(
    `LabShelf: Found ${formatSyncTool(offer.tool)}. Move the library to ${formatPath(target, home)}?`, "Move", "Not now",
  );
  if (answer === "Move") { await moveLibraryTo(controller, target); }
  if (answer === "Not now") {
    await dismiss(offer.tool);
    await services.logger.log("INFO", "libraryMove", "Move offer dismissed", { tool: offer.tool });
  }
}
