// Tells the Typst language server which file is the main document of the Typst project being edited.
import * as vscode from "vscode";

import { owningProject } from "../../mainDocument.js";
import type { WritingHost, WritingProjects } from "../../session/index.js";
import type { TypstLanguageServer } from "./typstLanguageServer.js";

// PLATFORM: Tinymist's `tinymist.pinMain` takes the main file path; its `pinMainToCurrent` pins only the active editor.
const PIN_COMMAND = "tinymist.pinMain";
const MODULE = "writing/typst";

export interface TypstMainPinDeps {
  context: vscode.ExtensionContext;
  server: Pick<TypstLanguageServer, "start">;
  host: Pick<WritingHost, "current">;
  projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">;
}

/** Pins when the active Typst project's main file differs from the last one pinned; a failed pin is retried on the next change. */
export function registerTypstMainPin(deps: TypstMainPinDeps): void {
  let pinned: string | undefined;
  const sync = async (): Promise<void> => {
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(deps.projects, file.fsPath) : undefined;
    if (project?.settings.format !== "typst" || !project.main) { return; }
    const main = deps.projects.paths.join(project.folder, project.main);
    if (main === pinned) { return; }
    // Set before the server answers so two quick editor changes pin once.
    pinned = main;
    const logger = deps.host.current()?.logger;
    try {
      const client = await deps.server.start();
      if (!client) { pinned = undefined; return; }
      await client.sendRequest("workspace/executeCommand", { command: PIN_COMMAND, arguments: [main] });
      await logger?.log("INFO", MODULE, "Pinned the Typst main file in the language server", { main });
    } catch (error) {
      pinned = undefined;
      await logger?.error(MODULE, error, { action: "pin-typst-main", main });
    }
  };
  const run = (): void => { void sync(); };
  deps.context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(run), deps.projects.onDidChange(run));
  run();
}
