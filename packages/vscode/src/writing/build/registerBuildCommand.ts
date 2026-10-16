// Registers Build Project: saves every editor and builds the active file's project with the builder for its format.
import * as vscode from "vscode";

import type { BuildRootOf } from "../nodePort/index.js";
import type { WritingProjects } from "../session/index.js";
import { activeProject } from "./activeProject.js";
import type { ProjectBuilders } from "./projectBuilders.js";

export const BUILD_COMMAND = "labshelf.writing.build";

interface BuildCommandDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "list" | "paths">;
  builders: ProjectBuilders;
  buildRootOf: BuildRootOf;
}

async function buildActive(deps: BuildCommandDeps): Promise<void> {
  const project = activeProject(deps.projects);
  if (!project) {
    await vscode.window.showInformationMessage("Open a file of a writing project to build it.");
    return;
  }
  await vscode.workspace.saveAll(false);
  const main = project.main ?? "";
  const file = vscode.window.activeTextEditor?.document.uri.fsPath;
  const root = file ? await deps.buildRootOf(project.folder, main, file) : main;
  await deps.builders[project.settings.format].request(project.folder, root, "command");
}

export function registerBuildCommand(deps: BuildCommandDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(BUILD_COMMAND, () => buildActive(deps)));
}
