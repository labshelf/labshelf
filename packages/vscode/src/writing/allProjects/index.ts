// Registers the All projects editor tab: the command that opens it and the library port that feeds it.
import * as vscode from "vscode";
import { AllProjectsPanel } from "./allProjectsPanel.js";
import { createProjectLibrary, type VscodeProjectLibraryDeps } from "./projectLibrary.js";

const ALL_PROJECTS_COMMAND = "labshelf.projects.all";

export interface AllProjectsDeps extends VscodeProjectLibraryDeps {
  context: vscode.ExtensionContext;
}

export function registerAllProjects({ context, ...library }: AllProjectsDeps): void {
  let panel: AllProjectsPanel | undefined;
  const open = (): void => {
    if (panel) { panel.reveal(); return; }
    panel = AllProjectsPanel.open(context.extensionUri, createProjectLibrary(library), library.logger, () => { panel = undefined; });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(ALL_PROJECTS_COMMAND, open),
    { dispose: () => panel?.dispose() },
  );
}
