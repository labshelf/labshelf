// Registers the commands that install native hosts and refreshes the installed launchers.
import * as vscode from "vscode";

import type { HostAdapters } from "../../serviceComposition/index.js";
import { buildLatexForBrowser } from "./buildLatexForBrowser.js";
import { connectBrowser } from "./connectBrowser.js";
import { refreshNativeHosts } from "./refreshNativeHosts.js";

export function registerNativeHostCommands(context: vscode.ExtensionContext, adapters: Pick<HostAdapters, "createLogger">): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.connectBrowser", () => connectBrowser(context, adapters.createLogger)),
    vscode.commands.registerCommand("labshelf.buildLatexForBrowser", () => buildLatexForBrowser(context, adapters.createLogger)),
  );
  void refreshNativeHosts(context, adapters.createLogger);
}
