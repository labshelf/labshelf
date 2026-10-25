// Registers the commands that choose a project's main file: Set as Main Document and the status bar's quick pick.
import * as vscode from "vscode";

import { findEntryCandidates } from "@labshelf/core";
import { runSafely } from "../command/index.js";
import { deriveBuildRootPath, findOwningProject, type ReadyProject } from "./buildRootDocument.js";
import type { WritingHost, WritingProjects } from "./session/index.js";

interface MainCommandsDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "reload">;
}

async function writeMain(deps: MainCommandsDeps, project: ReadyProject, main: string): Promise<void> {
  const session = deps.host.current();
  if (!session) { return; }
  await runSafely(session.logger, "labshelf.writing.setMain", async () => {
    await deps.projects.data.updateProjectSettings(project.folder, { main });
    await deps.projects.reload();
  });
}

async function setMain(deps: MainCommandsDeps, file: vscode.Uri | undefined): Promise<void> {
  if (!file) { return; }
  const project = findOwningProject(deps.projects, file.fsPath);
  if (!project) {
    await vscode.window.showErrorMessage(`${deps.projects.paths.basename(file.fsPath)} is not inside a LabShelf project.`);
    return;
  }
  if (findEntryCandidates(project.settings.format, [deps.projects.paths.basename(file.fsPath)]).length === 0) {
    await vscode.window.showErrorMessage(
      `${deps.projects.paths.basename(file.fsPath)} does not match the ${project.settings.format} format of project "${project.settings.id}".`,
    );
    return;
  }
  await writeMain(deps, project, deriveBuildRootPath(deps.projects.paths, project, file.fsPath));
}

async function pickMain(deps: MainCommandsDeps): Promise<void> {
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  const project = active ? findOwningProject(deps.projects, active) : undefined;
  if (!project) { return; }
  const candidates = findEntryCandidates(project.settings.format, await deps.projects.data.rootFileNames(project.folder));
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

export function registerBuildRootCommands(deps: MainCommandsDeps): void {
  deps.context.subscriptions.push(
    // The sidebar Files tree passes its row ({ uri }); editors and the Explorer pass a Uri.
    vscode.commands.registerCommand("labshelf.writing.setMain", (file?: vscode.Uri | { uri: vscode.Uri }) => setMain(deps, file instanceof vscode.Uri ? file : file?.uri)),
    vscode.commands.registerCommand("labshelf.writing.pickMain", () => pickMain(deps)),
  );
}
