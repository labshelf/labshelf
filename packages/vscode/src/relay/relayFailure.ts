// Reports a failed relay action: logged without secrets, shown without waiting; a cancelled one is only logged.
import * as vscode from "vscode";

import { formatError, type ILogger } from "@labshelf/core";
import { LOG_MODULE } from "./relayAccounts.js";

export function reportRelayFailure(logger: ILogger, action: string, error: unknown): void {
  if (error instanceof vscode.CancellationError) {
    void logger.log("INFO", LOG_MODULE, "Relay action cancelled", { action });
    return;
  }
  void logger.error(LOG_MODULE, error, { action });
  void vscode.window.showErrorMessage(`LabShelf could not ${action}: ${formatError(error)}`);
}
