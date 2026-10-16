// Registers the commands of a project row: Reveal in File Explorer and Remove from LabShelf.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { executeSafely } from "../commands/index.js";
import type { WritingHost, WritingProjects } from "./session/index.js";

interface ItemCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: WritingProjects;
}

async function removeProject({ host, projects }: ItemCommandsDeps, entry: ProjectEntry | undefined): Promise<void> {
  const session = host.current();
  if (!session || entry?.location !== "external") { return; }
  await executeSafely(session.logger, "labshelf.writing.removeProject", async () => {
    const remove = "Remove from LabShelf";
    const answer = await vscode.window.showWarningMessage(
      `Remove "${entry.kind === "ready" ? entry.settings.id : entry.folder}" from LabShelf?`,
      { modal: true, detail: `The files in ${entry.folder} are not deleted.` },
      remove,
    );
    if (answer !== remove) { return; }
    await projects.data.unregisterProjectFolder(session.root, entry.folder);
    await projects.reload();
  });
}

export function registerProjectItemCommands(deps: ItemCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.reveal", (entry?: ProjectEntry) =>
      entry ? vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(entry.folder)) : undefined),
    vscode.commands.registerCommand("labshelf.writing.removeProject", (entry?: ProjectEntry) => removeProject(deps, entry)),
  );
}
