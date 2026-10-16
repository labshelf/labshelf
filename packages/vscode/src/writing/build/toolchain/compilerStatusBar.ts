// Shows the LaTeX compiler of the project that owns the active editor's file in the status bar and opens the compiler pick on click.
import * as vscode from "vscode";

import { engineLabel } from "@labshelf/core";
import { owningProject } from "../../mainDocument.js";
import type { WritingProjects } from "../../projectStore.js";
import { PICK_COMPILER_COMMAND } from "./pickCompiler.js";

export function registerCompilerStatusBar(context: vscode.ExtensionContext, projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">): void {
  // Priority 49 places it right after the main-document item (50).
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
  item.command = PICK_COMPILER_COMMAND;

  const update = (): void => {
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(projects, file.fsPath) : undefined;
    if (project?.settings.format !== "latex") {
      item.hide();
      return;
    }
    const engine = project.settings.engine;
    item.text = engine ? `$(gear) ${engineLabel(engine)} $(chevron-down)` : "$(gear) Choose compiler";
    item.tooltip = `LaTeX compiler of ${project.settings.id}. Click to change it.`;
    item.show();
  };

  context.subscriptions.push(item, projects.onDidChange(update), vscode.window.onDidChangeActiveTextEditor(update));
  update();
}
