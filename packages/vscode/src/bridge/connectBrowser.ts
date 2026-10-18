// Installs the browser bridge from VS Code and tells the user which browsers were set up.
import * as path from "node:path";
import * as vscode from "vscode";

import { errorMessage, type ILogger } from "@labshelf/core";
import { bridgeLogPath, installBridge, systemBridgeEnv, type BridgeInstallResult } from "@labshelf/core/node";

const LOG_MODULE = "bridge-install";

async function report(result: BridgeInstallResult): Promise<void> {
  if (result.browsers.length > 0) {
    const names = result.browsers.map((browser) => browser.label).join(", ");
    void vscode.window.showInformationMessage(`LabShelf is connected to ${names}. Restart the browser, then open the LabShelf extension and choose Connect.`);
  }
  if (result.browsers.length === 0 && result.warnings.length === 0) {
    void vscode.window.showWarningMessage("LabShelf found no supported browser (Chrome, Chromium, Brave or Firefox). Install one and run Connect the Browser again.");
  }
  for (const warning of result.warnings) void vscode.window.showWarningMessage(warning.message);
}

export async function connectBrowser(context: vscode.ExtensionContext, createLogger: (logPath: string) => ILogger): Promise<void> {
  const logger = createLogger(bridgeLogPath());
  // The extension host is an Electron binary, which acts as Node only with ELECTRON_RUN_AS_NODE=1.
  const launch = { nodePath: process.execPath, hostScript: path.join(context.extensionPath, "out", "bridgeHost.js"), electronRunAsNode: true };
  try {
    await report(await installBridge(systemBridgeEnv(logger), launch));
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "connect the browser" });
    void vscode.window.showErrorMessage(`LabShelf could not connect the browser: ${errorMessage(error)}`);
  }
}
