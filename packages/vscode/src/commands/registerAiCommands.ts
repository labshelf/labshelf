// Registers the labshelf.ai.* commands.
// INVARIANT: handlers resolve the AiService lazily, because it can be created after activation.
import * as vscode from "vscode";
import type { AiService } from "../ai/service/index.js";

export type AiServiceProvider = () => AiService | null;

const REQUIRED_MESSAGE = "LabShelf AI is not available. Configure a library and ensure AI is enabled in settings.";

/**
 * Registers labshelf.ai.rebuildIndex, labshelf.ai.searchByClaim,
 * labshelf.ai.searchByText, and labshelf.ai.openSettings.
 */
export function registerAiCommands(
  context: vscode.ExtensionContext,
  getAiService: AiServiceProvider,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.ai.rebuildIndex", withAiService(getAiService, rebuildIndex)),
    vscode.commands.registerCommand("labshelf.ai.searchByClaim", withAiService(getAiService, searchByClaim)),
    vscode.commands.registerCommand("labshelf.ai.searchByText", withAiService(getAiService, searchByText)),
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
    { location: vscode.ProgressLocation.Notification, title: "LabShelf: rebuilding AI index" },
    async () => {
      await service.rebuildAll();
    },
  );
}

async function searchByClaim(service: AiService): Promise<void> {
  const claim = await vscode.window.showInputBox({
    prompt: "Enter a claim. Results will be classified as support / contradict / neutral.",
    placeHolder: "transformers scale better than RNNs in long contexts",
  });
  if (!claim) return;
  const results = await service.searchByClaim(claim);
  if (results.length === 0) {
    vscode.window.showInformationMessage("LabShelf AI: no relevant evidence found.");
    return;
  }
  showClaimResults(claim, results);
}

async function searchByText(service: AiService): Promise<void> {
  const query = await vscode.window.showInputBox({
    prompt: "Semantic search across your library",
  });
  if (!query) return;
  const results = await service.searchByText(query, 10);
  const items = results.map((m) => ({
    label: m.text ? m.text.slice(0, 120) : `(${m.kind})`,
    description: `paper:${m.paperId} score:${m.score.toFixed(3)}`,
  }));
  await vscode.window.showQuickPick(items, { placeHolder: `${results.length} matches` });
}

function showClaimResults(
  claim: string,
  results: Awaited<ReturnType<AiService["searchByClaim"]>>,
): void {
  const grouped = {
    support: results.filter((r) => r.stance === "support"),
    contradict: results.filter((r) => r.stance === "contradict"),
    neutral: results.filter((r) => r.stance === "neutral"),
  };
  const summary = `Claim: ${claim}\n  support: ${grouped.support.length}\n  contradict: ${grouped.contradict.length}\n  neutral: ${grouped.neutral.length}`;
  vscode.window.showInformationMessage(summary);
}
