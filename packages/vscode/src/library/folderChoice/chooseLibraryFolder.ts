// Asks for the library folder with the open dialog and records it, for hosts that cannot look for sync folders (the web build).
import * as vscode from "vscode";

import { errorMessage, type ILogger } from "@labshelf/core";
import type { SharedLibraryConfig } from "../../storage/paths/index.js";

export interface ChooseLibraryFolderDeps {
  sharedLibraryConfig: SharedLibraryConfig;
  logger: ILogger;
}

/** @returns the chosen library root, or undefined when the user cancelled or the choice could not be saved */
export async function chooseLibraryFolder(deps: ChooseLibraryFolderDeps): Promise<vscode.Uri | undefined> {
  const picked = (await vscode.window.showOpenDialog({
    canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
    openLabel: "Select library folder", title: "LabShelf: Choose Library Folder",
  }))?.[0];
  if (!picked) { return undefined; }
  // INVARIANT: the extension names library files by path and opens them as file: URIs, so the folder must be one.
  if (picked.scheme !== "file") {
    await deps.logger.log("WARN", "firstRun", "Library folder is not a file: folder", { uri: picked.toString() });
    await vscode.window.showErrorMessage("LabShelf: The library must be a folder on this computer.");
    return undefined;
  }
  try {
    await deps.sharedLibraryConfig.recordRoot(picked.fsPath, deps.logger);
    await deps.logger.log("INFO", "firstRun", "Library location chosen", { root: picked.fsPath });
    return picked;
  } catch (error) {
    await deps.logger.error("firstRun", error, { action: "record library root", root: picked.fsPath });
    await vscode.window.showErrorMessage(`LabShelf: Failed to use ${picked.fsPath}: ${errorMessage(error)}`);
    return undefined;
  }
}
