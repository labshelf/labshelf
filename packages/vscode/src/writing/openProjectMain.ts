// Opens a project's main file in the editor, or says the project has none.
import * as vscode from "vscode";

import type { PathOps, ProjectEntry } from "@labshelf/core";

export async function openProjectMain(paths: PathOps, entry: ProjectEntry | undefined): Promise<void> {
  if (entry?.kind !== "ready") { return; }
  if (!entry.main) {
    await vscode.window.showInformationMessage(`Project "${entry.settings.id}" has no main file yet.`);
    return;
  }
  await vscode.commands.executeCommand("vscode.open", vscode.Uri.file(paths.join(entry.folder, entry.main)));
}
