// Registers the commands of a project row: Open Main Document, Reveal in File Explorer and Remove from LabShelf.
import * as vscode from "vscode";

import type { ProjectEntry } from "@labshelf/core";
import { unregisterProjectFolder } from "@labshelf/core/node";
import { executeSafely } from "../commands/index.js";
import { openProjectMain } from "./openProjectMain.js";
import type { WritingHost, WritingProjects } from "./projectStore.js";

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
    await unregisterProjectFolder(session.root, entry.folder, session.logger);
    await projects.reload();
  });
}

export function registerProjectItemCommands(deps: ItemCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.openMain", (entry?: ProjectEntry) => openProjectMain(deps.projects.paths, entry)),
    vscode.commands.registerCommand("labshelf.writing.reveal", (entry?: ProjectEntry) =>
      entry ? vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(entry.folder)) : undefined),
    vscode.commands.registerCommand("labshelf.writing.removeProject", (entry?: ProjectEntry) => removeProject(deps, entry)),
  );
}
