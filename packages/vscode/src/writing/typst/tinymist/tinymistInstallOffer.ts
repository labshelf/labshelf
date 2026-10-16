// Offers once per workspace to install Tinymist when a Typst project is open without it.
import * as vscode from "vscode";

import { owningProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../projectStore.js";
import { TINYMIST_ID, tinymistInstalled } from "./tinymistExtension.js";

const SHOWN_KEY = "labshelf.writing.tinymistOfferShown";
const INSTALL = "Install Tinymist";
const NOT_NOW = "Not now";
const MODULE = "writing/typst";

export interface TinymistOfferDeps {
  context: vscode.ExtensionContext;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths">;
}

async function install(deps: TinymistOfferDeps): Promise<void> {
  const logger = deps.host.current()?.logger;
  try {
    await vscode.commands.executeCommand("workbench.extensions.installExtension", TINYMIST_ID);
    await logger?.log("INFO", MODULE, "Installed Tinymist", { id: TINYMIST_ID });
  } catch (error) {
    await logger?.error(MODULE, error, { action: "install-tinymist" });
    await vscode.window.showErrorMessage(`Tinymist could not be installed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function showOffer(deps: TinymistOfferDeps): Promise<void> {
  // Set before the message resolves so a second editor change cannot show it again while it is open.
  await deps.context.workspaceState.update(SHOWN_KEY, true);
  const choice = await vscode.window.showInformationMessage(
    "Tinymist adds Typst completion and errors while you type; LabShelf shows the preview.",
    INSTALL,
    NOT_NOW,
  );
  await deps.host.current()?.logger.log("INFO", MODULE, "Tinymist offer answered", { choice: choice ?? "dismissed" });
  if (choice === INSTALL) { await install(deps); }
}

/** Checks the active editor now and on every change. */
export function registerTinymistOffer(deps: TinymistOfferDeps): void {
  const check = (): void => {
    if (deps.context.workspaceState.get<boolean>(SHOWN_KEY) || tinymistInstalled()) { return; }
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
    if (project?.settings.format === "typst") { void showOffer(deps); }
  };
  deps.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(check));
  check();
}
