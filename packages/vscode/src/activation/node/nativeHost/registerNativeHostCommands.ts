// Registers the commands that install native hosts and refreshes the installed launchers.
import * as vscode from "vscode";

import type { HostAdapters } from "../../hostAdapters.js";
import { connectBrowser } from "./connectBrowser.js";
import { refreshNativeHosts } from "./refreshNativeHosts.js";
import { formatError, type ILogger } from "@labshelf/core";
import { resolveBridgeLogPath } from "@labshelf/core/node";
import {
  HELPER_HOST_SPEC,
  installNativeHost,
  createSystemNativeHostEnv,
  type NativeHostInstallResult,
} from "@labshelf/core/nativeHost/node";
import { createScriptLaunch } from "./hostLaunch.js";
import { reportWarnings, SUPPORTED_BROWSERS } from "./reportInstall.js";

const LOG_MODULE = "helper-install";
const USE_VS_CODE = "Use VS Code instead";

async function buildLatexForBrowser(context: vscode.ExtensionContext, createLogger: (logPath: string) => ILogger, replaceStandalone = false): Promise<void> {
  const logger = createLogger(resolveBridgeLogPath());
  try {
    const result = await installNativeHost(createSystemNativeHostEnv(logger), HELPER_HOST_SPEC, createScriptLaunch(context, "helperHost"), { replaceStandalone });
    await report(result, () => buildLatexForBrowser(context, createLogger, true));
  } catch (error) {
    await logger.error(LOG_MODULE, error, { action: "build LaTeX for the browser" });
    void vscode.window.showErrorMessage(`LabShelf could not set up LaTeX for the browser: ${formatError(error)}`);
  }
}

async function report(result: NativeHostInstallResult, replaceStandalone: () => Promise<void>): Promise<void> {
  if (result.standalone) {
    const choice = await vscode.window.showInformationMessage("LabShelf Helper is installed and builds LaTeX for the browser.", USE_VS_CODE);
    if (choice === USE_VS_CODE) await replaceStandalone();
    return;
  }
  if (result.browsers.length > 0) {
    const names = result.browsers.map((browser) => browser.label).join(", ");
    void vscode.window.showInformationMessage(`LabShelf can now build LaTeX for ${names}. Return to the browser; its LaTeX section notices VS Code.`);
  } else if (result.warnings.length === 0) {
    void vscode.window.showWarningMessage(`LabShelf found no supported browser (${SUPPORTED_BROWSERS}). Install one and run Build LaTeX for the Browser again.`);
  }
  reportWarnings(result.warnings);
}

export function registerNativeHostCommands(context: vscode.ExtensionContext, adapters: Pick<HostAdapters, "createLogger">): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.connectBrowser", () => connectBrowser(context, adapters.createLogger)),
    vscode.commands.registerCommand("labshelf.buildLatexForBrowser", () => buildLatexForBrowser(context, adapters.createLogger)),
  );
  void refreshNativeHosts(context, adapters.createLogger);
}
