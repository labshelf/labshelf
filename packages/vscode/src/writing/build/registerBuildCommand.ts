// Registers Build Project: saves every editor and builds the active file's project with the builder for its format.
import * as vscode from "vscode";

import type { ProjectFormat } from "@labshelf/core";
import type { WritingProjects } from "../projectStore.js";
import { activeProject } from "./activeProject.js";

export const BUILD_COMMAND = "labshelf.writing.build";

interface BuildCommandDeps {
  context: vscode.ExtensionContext;
  projects: Pick<WritingProjects, "list">;
  builders: Record<ProjectFormat, { request(projectFolder: string, trigger: "command"): Promise<unknown> }>;
}

async function buildActive(deps: BuildCommandDeps): Promise<void> {
  const project = activeProject(deps.projects);
  if (!project) {
    await vscode.window.showInformationMessage("Open a file of a writing project to build it.");
    return;
  }
  await vscode.workspace.saveAll(false);
  await deps.builders[project.settings.format].request(project.folder, "command");
}

export function registerBuildCommand(deps: BuildCommandDeps): void {
  deps.context.subscriptions.push(vscode.commands.registerCommand(BUILD_COMMAND, () => buildActive(deps)));
}
