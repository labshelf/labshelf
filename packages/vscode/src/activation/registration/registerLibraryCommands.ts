// Registers the Library view's own commands: refreshing, folder commands,
// importing into a folder, and configuring the library root.
import * as vscode from "vscode";

import { importPapersFromDialog, registerFolderCommands, type FolderCommandHost } from "../../commands/index.js";
import type { LibraryNode, LibrarySidebarView } from "../../ui/library/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";

export interface LibraryCommandsDeps {
  context: vscode.ExtensionContext;
  controller: LibraryRootController;
  folderHost: FolderCommandHost;
  librarySidebar: LibrarySidebarView;
}

function registerLibraryViewCommands(deps: LibraryCommandsDeps): void {
  const { context, controller, folderHost, librarySidebar } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.library.refresh", async () => {
      await controller.currentServices()?.reindexLibrary();
      librarySidebar.refresh();
    }),
  );

  registerFolderCommands(context, folderHost);
}

function registerAddPaperAndConfigureCommands(deps: LibraryCommandsDeps): void {
  const { context, controller, folderHost } = deps;

  // Import papers into a specific folder chosen from the Library sidebar's context menu.
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
