// Registers the empty Settings sidebar view (its content is the package.json viewsWelcome link) and the
// settings webview panel command.
import * as vscode from "vscode";

import { SettingsWebviewPanel } from "../../ui/settings/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";

export interface SettingsViewDeps {
  context: vscode.ExtensionContext;
  controller: LibraryRootController;
  driveStatusChanged: vscode.EventEmitter<void>;
}

export function registerSettingsView(deps: SettingsViewDeps): void {
  const { context, controller, driveStatusChanged } = deps;

  // SETTINGS sidebar view — empty tree provider so viewsWelcome (defined in
  // package.json) renders its "Open settings" link as the section content.
  const emptyProvider: vscode.TreeDataProvider<never> = {
    getTreeItem: (e: never) => e,
    getChildren: () => [],
  };
  context.subscriptions.push(
    vscode.window.createTreeView("labshelf.settings", { treeDataProvider: emptyProvider }),
  );

  // Settings webpanel — currently the only place to manage Drive, sync interval, etc.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openSettings", () => {
      SettingsWebviewPanel.createOrShow(context.extensionUri, {
        getLibraryRoot: () => controller.currentRoot() ?? null,
        getDriveStatus: () => controller.syncController()?.driveStatus() ?? null,
        onDidChangeDriveStatus: driveStatusChanged.event,
        getLogger: () => controller.currentServices()?.logger,
        reconfigureLibrary: async () => {
          const services = await controller.reconfigure();
          return services ? controller.currentRoot() : undefined;
        },
      });
    }),
  );
}
