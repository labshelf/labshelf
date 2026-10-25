// Registers the command that opens the sync guide.
import * as vscode from "vscode";
import type { ILogger } from "@labshelf/core";
import { openSyncGuide } from "./syncGuidePanel.js";

export function registerSyncGuideCommand(context: vscode.ExtensionContext, getLogger: () => ILogger | undefined): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.syncGuide", () => openSyncGuide(context.extensionUri, getLogger())),
  );
}
