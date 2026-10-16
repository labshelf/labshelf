// Shows the main document of the project that owns the active editor's file in the status bar, and hides it elsewhere.
import * as vscode from "vscode";

import { owningProject } from "./mainDocument.js";
import type { WritingProjects } from "./projectStore.js";

const PICK_MAIN_COMMAND = "labshelf.writing.pickMain";

export function registerMainStatusBar(context: vscode.ExtensionContext, projects: Pick<WritingProjects, "list" | "paths" | "onDidChange">): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = PICK_MAIN_COMMAND;

  const update = (): void => {
    const file = vscode.window.activeTextEditor?.document.uri;
    const project = file?.scheme === "file" ? owningProject(projects, file.fsPath) : undefined;
    if (!project) {
      item.hide();
      return;
    }
    item.text = `$(file) ${project.main ?? "no main file"}`;
    item.tooltip = `Main document of ${project.settings.id}. Click to change it.`;
    item.show();
  };

  context.subscriptions.push(item, projects.onDidChange(update), vscode.window.onDidChangeActiveTextEditor(update));
  update();
}
