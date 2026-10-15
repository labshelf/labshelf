// Registers the Settings sidebar view, whose content is its package.json viewsWelcome buttons, and the command behind "Open settings".
import * as vscode from "vscode";

import type { LibraryRootController } from "../libraryLifecycle/index.js";

export function registerSettingsWelcomeView(context: vscode.ExtensionContext, controller: LibraryRootController): void {
  // A view with no children shows its viewsWelcome entries.
  const noChildren: vscode.TreeDataProvider<never> = {
    getTreeItem: (element: never) => element,
    getChildren: () => [],
  };
  const view = vscode.window.createTreeView("labshelf.settings", { treeDataProvider: noChildren });
  // viewsWelcome text is static, so the header carries the library folder.
  const showRoot = (root: vscode.Uri | undefined): void => { view.description = root?.fsPath ?? ""; };
  showRoot(controller.currentRoot());
  context.subscriptions.push(
    view,
    controller.onDidChangeRoot(({ root }) => showRoot(root)),
    vscode.commands.registerCommand("labshelf.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "labshelf")),
  );
}
