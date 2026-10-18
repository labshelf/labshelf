// Reports a failed relay action: logged without secrets, shown without waiting.
import * as vscode from "vscode";

import type { ILogger } from "@labshelf/core";
import { LOG_MODULE } from "./relayAccounts.js";

export function reportRelayFailure(logger: ILogger, action: string, error: unknown): void {
  void logger.error(LOG_MODULE, error, { action });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${error instanceof Error ? error.message : String(error)}`);
}
