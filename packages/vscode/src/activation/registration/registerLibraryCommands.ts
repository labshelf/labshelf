// Registers the Library view's own commands: collapsing sections, refreshing, folder commands,
// importing into a folder, and configuring the library root.
import * as vscode from "vscode";

import { importPapersFromDialog, registerFolderCommands, type FolderCommandHost } from "../../commands/index.js";
import type { LibraryNode } from "../../ui/library/index.js";
import type { LibraryTreeDataProvider } from "../../ui/library/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";

export interface LibraryCommandsDeps {
  context: vscode.ExtensionContext;
  controller: LibraryRootController;
  folderHost: FolderCommandHost;
  libraryProvider: LibraryTreeDataProvider;
}

function registerLibraryViewCommands(deps: LibraryCommandsDeps): void {
  const { context, controller, folderHost, libraryProvider } = deps;

  // Collapses tree items inside every LabShelf view at once — same effect as
  // clicking each view's individual "collapse all" button. VS Code has no API to
  // close the section panels themselves, so this is the closest equivalent.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.collapseAllSections", async () => {
      const viewIds = [
        "labshelf.library",
      ];
      for (const id of viewIds) {
        await vscode.commands.executeCommand(`workbench.actions.treeView.${id}.collapseAll`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.library.refresh", async () => {
      await controller.currentServices()?.reindexLibrary();
      libraryProvider.refresh();
    }),
  );

  registerFolderCommands(context, folderHost);
}

function registerAddPaperAndConfigureCommands(deps: LibraryCommandsDeps): void {
  const { context, controller, folderHost } = deps;

  // Import papers into a specific folder selected via the tree context menu.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaperHere", async (node?: LibraryNode) => {
      const services = await folderHost.requireServices();
      if (!services) { return; }

      await importPapersFromDialog(services, node?.dirPath);
    }),
  );

  // Configure or reconfigure the library root via the setup wizard.
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.configureLibrary", async () => {
      const services = await controller.reconfigure();
      if (!services) { return; }
      vscode.window.showInformationMessage(`LabShelf: Library configured at ${controller.currentRoot()?.fsPath}`);
    }),
  );
}

export function registerLibraryCommands(deps: LibraryCommandsDeps): void {
  registerLibraryViewCommands(deps);
  registerAddPaperAndConfigureCommands(deps);
}
