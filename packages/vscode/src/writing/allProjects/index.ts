// Registers the All projects editor tab: the command that opens it and the library port that feeds it.
import * as vscode from "vscode";
import { AllProjectsPanel, type AllProjectsSelection } from "./allProjectsPanel.js";
import type { ProjectLibraryPort } from "@labshelf/core";
import { createProjectLibrary, type VscodeProjectLibraryDeps } from "./projectLibrary.js";

const ALL_PROJECTS_COMMAND = "labshelf.projects.all";

export interface AllProjectsDeps extends VscodeProjectLibraryDeps {
  context: vscode.ExtensionContext;
  /** Reports the page's project selection and the tab becoming active, for the Details view. */
  selection: AllProjectsSelection;
}

/** @returns the factory of the library port the All projects page reads, which the Details view serves too */
export function registerAllProjects({ context, selection, ...library }: AllProjectsDeps): () => ProjectLibraryPort {
  let panel: AllProjectsPanel | undefined;
  const open = (): void => {
    if (panel) { panel.reveal(); return; }
    panel = AllProjectsPanel.open(context.extensionUri, createProjectLibrary(library), library.logger, selection, () => { panel = undefined; });
  };
  context.subscriptions.push(
    vscode.commands.registerCommand(ALL_PROJECTS_COMMAND, open),
    { dispose: () => panel?.dispose() },
  );
  return () => createProjectLibrary(library);
}
