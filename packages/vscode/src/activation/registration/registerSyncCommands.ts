// Registers the Drive sync commands, delegating to the SyncController owned by the library root controller.
import * as vscode from "vscode";

import type { ActiveServices } from "../../commands/index.js";
import type { LibraryRootController } from "../libraryLifecycle/index.js";

export interface SyncCommandsDeps {
  context: vscode.ExtensionContext;
  controller: LibraryRootController;
  requireServices: () => Promise<ActiveServices | null>;
}

// Sync commands require the library to be configured before delegating to SyncController.
export function registerSyncCommands(deps: SyncCommandsDeps): void {
  const { context, controller, requireServices } = deps;
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.sync.connect", async () => {
      if (!(await requireServices())) { return; }
      await controller.syncController()?.connect();
    }),
    vscode.commands.registerCommand("labshelf.sync.now", async () => {
      if (!(await requireServices())) { return; }
      await controller.syncController()?.sync();
    }),
    vscode.commands.registerCommand("labshelf.sync.disconnect", async () => {
      await controller.syncController()?.disconnect();
    }),
  );
}
