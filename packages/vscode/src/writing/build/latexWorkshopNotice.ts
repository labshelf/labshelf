// Tells the user once per workspace that LaTeX Workshop builds on save too, and offers to turn that off.
import * as vscode from "vscode";

import { owningProject } from "../buildRootDocument.js";
import type { WritingHost, WritingProjects } from "../session/index.js";

const LATEX_WORKSHOP_ID = "James-Yu.latex-workshop";
const SHOWN_KEY = "labshelf.writing.latexWorkshopNoticeShown";
const TURN_OFF = "Turn off its auto build";
const MODULE = "writing/build";

interface NoticeDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  projects: Pick<WritingProjects, "list" | "paths">;
}

async function turnOffAutoBuild(host: WritingHost): Promise<void> {
  const logger = host.current()?.logger;
  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
  try {
    await vscode.workspace.getConfiguration("latex-workshop").update("latex.autoBuild.run", "never", target);
    await logger?.log("INFO", MODULE, "Turned off LaTeX Workshop auto build", { target });
  } catch (error) {
    await logger?.error(MODULE, error, { action: "turn-off-latex-workshop-auto-build", target });
    await vscode.window.showErrorMessage(
      `LaTeX Workshop's auto build could not be turned off: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function showNotice(deps: NoticeDeps): Promise<void> {
  // Set before the message resolves so a second editor change cannot show it again while it is open.
  await deps.context.workspaceState.update(SHOWN_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    "LaTeX Workshop is also installed. LabShelf builds, previews and reports errors for LabShelf projects, so both would build on save.",
    TURN_OFF,
  );
  await deps.host.current()?.logger.log("INFO", MODULE, "LaTeX Workshop notice answered", { choice: choice ?? "dismissed" });
  if (choice === TURN_OFF) { await turnOffAutoBuild(deps.host); }
}

export function registerLatexWorkshopNotice(deps: NoticeDeps): void {
  const check = (): void => {
    if (deps.context.workspaceState.get<boolean>(SHOWN_KEY)) { return; }
    if (!vscode.extensions.getExtension(LATEX_WORKSHOP_ID)) { return; }
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
    if (project?.settings.format === "latex") { void showNotice(deps); }
  };
  deps.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(check));
  check();
}
