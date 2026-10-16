// Registers the commands that choose a project's main file: Set as Main Document and the status bar's quick pick.
import * as path from "node:path";
import * as vscode from "vscode";

import { mainCandidates } from "@labshelf/core";
import { rootFileNames, updateProjectSettings } from "@labshelf/core/node";
import { executeSafely } from "../commands/index.js";
import { mainPathIn, owningProject, type ReadyProject } from "./mainDocument.js";
import type { WritingHost, WritingProjects } from "./projectStore.js";

interface MainCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths" | "reload">;
}

async function writeMain(deps: MainCommandsDeps, project: ReadyProject, main: string): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await executeSafely(session.logger, "labshelf.writing.setMain", async () => {
    await updateProjectSettings(project.folder, { main }, session.logger);
    await deps.projects.reload();
  });
}

async function setMain(deps: MainCommandsDeps, file: vscode.Uri | undefined): Promise<void> {
  if (!file) { return; }
  const project = owningProject(deps.projects, file.fsPath);
  if (!project) {
    await vscode.window.showErrorMessage(`${path.basename(file.fsPath)} is not inside a LabShelf project.`);
    return;
  }
  if (mainCandidates(project.settings.format, [path.basename(file.fsPath)]).length === 0) {
    await vscode.window.showErrorMessage(
      `${path.basename(file.fsPath)} does not match the ${project.settings.format} format of project "${project.settings.id}".`,
    );
    return;
  }
  await writeMain(deps, project, mainPathIn(deps.projects.paths, project, file.fsPath));
}

async function pickMain(deps: MainCommandsDeps): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const project = active ? owningProject(deps.projects, active) : undefined;
  if (!project) { return; }
  const candidates = mainCandidates(project.settings.format, await rootFileNames(project.folder));
  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(`Project "${project.settings.id}" has no ${project.settings.format} file in its folder.`);
    return;
  }
  const picked = await vscode.window.showQuickPick(
    candidates.map((name) => ({ label: name, description: name === project.main ? "current main" : "" })),
    { placeHolder: `Main document of ${project.settings.id}` },
  );
  if (picked && picked.label !== project.main) { await writeMain(deps, project, picked.label); }
}

export function registerMainCommands(deps: MainCommandsDeps): void {
  deps.context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.writing.setMain", (file?: vscode.Uri) => setMain(deps, file)),
    vscode.commands.registerCommand("labshelf.writing.pickMain", () => pickMain(deps)),
  );
}
