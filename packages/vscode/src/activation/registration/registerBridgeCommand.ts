// Registers the command that connects the browser extension to the library.
import * as vscode from "vscode";

import { connectBrowser } from "../../bridge/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

export function registerBridgeCommand(context: vscode.ExtensionContext, adapters: Pick<HostAdapters, "createLogger">): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.connectBrowser", () => connectBrowser(context, adapters.createLogger)),
  );
}
