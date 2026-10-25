// Moves the open library to a new folder with progress, then reopens it there.
import * as vscode from "vscode";

import { errorMessage } from "@labshelf/core";
import { moveLibrary } from "@labshelf/core/node";
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
    await vscode.window.showErrorMessage(errorMessage(error));
    return false;
  }
}
