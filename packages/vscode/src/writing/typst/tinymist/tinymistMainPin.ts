// Tells Tinymist which file is the main document of the Typst project being edited.
import * as vscode from "vscode";

import { owningProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import { tinymistInstalled } from "./tinymistExtension.js";

// PLATFORM: Tinymist's language server advertises `tinymist.pinMain` (path argument) and the VS Code client exposes it as a command; its own `tinymist.pinMainToCurrent` pins only the active editor.
const PIN_COMMAND = "tinymist.pinMain";
const MODULE = "writing/typst";

export interface TinymistPinDeps {
  context: vscode.ExtensionContext;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">;
}

/** Pins when the active Typst project's main file differs from the last one pinned; a failed pin is retried on the next change. */
export function registerTinymistMainPin(deps: TinymistPinDeps): void {
  let pinned: string | undefined;
  const sync = async (): Promise<void> => {
    if (!tinymistInstalled()) { return; }
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
    if (project?.settings.format !== "typst" || !project.main) { return; }
    const main = deps.projects.paths.join(project.folder, project.main);
    if (main === pinned) { return; }
    const logger = deps.host.current()?.logger;
    // Set before the command resolves so two quick editor changes pin once.
    pinned = main;
    try {
      await vscode.commands.executeCommand(PIN_COMMAND, main);
      await logger?.log("INFO", MODULE, "Pinned the Typst main file in Tinymist", { main });
    } catch (error) {
      pinned = undefined;
      await logger?.error(MODULE, error, { action: "pin-tinymist-main", main });
    }
  };
  const run = (): void => { void sync(); };
  deps.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(run), deps.projects.onDidChange(run));
  run();
}
