// Registers the labshelf.ai.* commands.
// INVARIANT: handlers resolve the AiService lazily, because it can be created after activation.
import * as vscode from "vscode";

import type { AiService } from "@labshelf/core";

export type AiServiceProvider = () => AiService | null;

const REQUIRED_MESSAGE = "Similar-paper indexing is not available. Configure a library and enable it in settings.";

/**
 * Registers labshelf.ai.rebuildIndex and labshelf.ai.openSettings.
 */
export function registerAiCommands(
  context: vscode.ExtensionContext,
  getAiService: AiServiceProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.ai.rebuildIndex", withAiService(getAiService, rebuildIndex)),
    vscode.commands.registerCommand("labshelf.ai.openSettings", () => {
      vscode.commands.executeCommand("workbench.action.openSettings", "labshelf.ai");
    }),
  );
}

function withAiService(
  getAiService: AiServiceProvider,
  run: (service: AiService) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const service = getAiService();
    if (!service) {
      vscode.window.showWarningMessage(REQUIRED_MESSAGE);
      return;
    }
    await run(service);
  };
}

async function rebuildIndex(service: AiService): Promise<void> {
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LabShelf: rebuilding the similar-paper index" },
    async () => {
      await service.rebuildAll();
    },
  );
}
