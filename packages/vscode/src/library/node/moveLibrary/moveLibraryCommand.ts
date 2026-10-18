// Implements "Move Library…": asks for the destination folder and moves the open library there.
import * as vscode from "vscode";

import type { LibraryRootController } from "../../../activation/libraryLifecycle/index.js";
import { libraryTargetFolder } from "../syncFolders/index.js";
import { moveLibraryTo } from "./moveLibraryTo.js";

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
  const target = await libraryTargetFolder(picked.fsPath);
  if (await moveLibraryTo(controller, target)) {
    vscode.window.showInformationMessage(`LabShelf: Library moved to ${target}`);
  }
}
