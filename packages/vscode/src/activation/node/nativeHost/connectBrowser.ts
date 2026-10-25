// Installs the browser bridge from VS Code and tells the user which browsers were set up.
import * as vscode from "vscode";

import { formatError, type ILogger } from "@labshelf/core";
import { resolveBridgeLogPath } from "@labshelf/core/node";
import { BRIDGE_HOST_SPEC, installNativeHost, createSystemNativeHostEnv, type NativeHostInstallResult } from "@labshelf/core/nativeHost/node";

import { createScriptLaunch } from "./hostLaunch.js";
import { reportWarnings, SUPPORTED_BROWSERS } from "./reportInstall.js";

const LOG_MODULE = "bridge-install";

function report(result: NativeHostInstallResult): void {
  if (result.browsers.length > 0) {
    const names = result.browsers.map((browser) => browser.label).join(", ");
    void vscode.window.showInformationMessage(`LabShelf is connected to ${names}. Restart the browser, then open the LabShelf extension and choose Connect.`);
  }
  if (result.browsers.length === 0 && result.warnings.length === 0) {
    void vscode.window.showWarningMessage(`LabShelf found no supported browser (${SUPPORTED_BROWSERS}). Install one and run Connect the Browser again.`);
  }
  reportWarnings(result.warnings);
}

export async function connectBrowser(context: vscode.ExtensionContext, createLogger: (logPath: string) => ILogger): Promise<void> {
  const logger = createLogger(resolveBridgeLogPath());
  try {
    report(await installNativeHost(createSystemNativeHostEnv(logger), BRIDGE_HOST_SPEC, createScriptLaunch(context, "bridgeHost")));
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "connect the browser" });
    void vscode.window.showErrorMessage(`LabShelf could not connect the browser: ${formatError(error)}`);
  }
}
