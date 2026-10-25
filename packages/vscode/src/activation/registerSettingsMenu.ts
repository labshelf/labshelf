// Registers the Settings gear menu of the LabShelf sidebar and the command that opens the VS Code settings page.
import * as vscode from "vscode";

import type { LibraryRootController } from "./libraryRootController.js";

interface SettingsChoice extends vscode.QuickPickItem {
  command: string;
}

function settingsChoices(controller: LibraryRootController): SettingsChoice[] {
  return [
    { label: "$(folder-opened) Change library folder…", description: controller.currentRoot()?.fsPath ?? "", command: "labshelf.configureLibrary" },
    { label: "$(settings-gear) Open settings", command: "labshelf.openSettings" },
    { label: "$(sparkle) AI settings", command: "labshelf.ai.openSettings" },
  ];
}

export function registerSettingsMenu(context: vscode.ExtensionContext, controller: LibraryRootController): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.settingsMenu", async () => {
      const picked = await vscode.window.showQuickPick(settingsChoices(controller), { placeHolder: "LabShelf settings" });
      if (picked) { await vscode.commands.executeCommand(picked.command); }
    }),
    vscode.commands.registerCommand("labshelf.openSettings", () => vscode.commands.executeCommand("workbench.action.openSettings", "labshelf")),
  );
}
