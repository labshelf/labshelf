// Registers Regenerate Figure: confirms the command once, runs it with progress and live output, and reports a failure.
import * as vscode from "vscode";

import { runFigureCommand } from "@labshelf/core/node";
import type { ILogger, FigureRunResult } from "@labshelf/core";
import { executeSafely } from "../../../commands/index.js";
import type { WritingHost } from "../../projectStore.js";
import { confirmFigureCommand } from "../figureConsent.js";
import type { FigureNode } from "../figureNode.js";
import type { ProjectFigures } from "../projectFigures.js";

const COMMAND = "labshelf.writing.regenerateFigure";
const MODULE = "writing/figures";
const SHOW_OUTPUT = "Show Output";

interface RegenerateDeps {
  context: vscode.ExtensionContext;
  host: WritingHost;
  figures: Pick<ProjectFigures, "refresh">;
  output: vscode.OutputChannel;
}

function runWithProgress(deps: RegenerateDeps, node: FigureNode): Thenable<FigureRunResult> {
  const options = { location: vscode.ProgressLocation.Notification, title: `Regenerating ${node.path}`, cancellable: true };
  return vscode.window.withProgress(options, (_progress, token) => {
    const abort = new AbortController();
    const cancel = token.onCancellationRequested(() => abort.abort());
    return runFigureCommand({
      command: node.recipe.run, cwd: node.project.folder, signal: abort.signal, onOutput: (chunk) => deps.output.append(chunk),
    }).finally(() => cancel.dispose());
  });
}

async function reportOutcome(deps: RegenerateDeps, logger: ILogger, node: FigureNode, result: FigureRunResult, durationMs: number): Promise<void> {
  const context = { project: node.project.settings.id, figure: node.path, command: node.recipe.run };
  if (result.status === "cancelled") {
    deps.output.appendLine("Cancelled.");
    await logger.log("INFO", MODULE, "figure command cancelled", { ...context, durationMs });
    return;
  }
  if (result.code === 0) {
    await logger.log("INFO", MODULE, "figure command finished", { ...context, exitCode: 0, durationMs });
    return;
  }
  deps.output.appendLine(`Exited with code ${result.code ?? "none (stopped by a signal)"}.`);
  await logger.error(MODULE, new Error(`Figure command exited with code ${result.code}`), { ...context, exitCode: result.code });
  // Not awaited: the tree refresh must not wait for the user to dismiss the message.
  void vscode.window.showErrorMessage(`Regenerating ${node.path} failed (exit code ${result.code ?? "none"}).`, SHOW_OUTPUT)
    .then((choice) => { if (choice === SHOW_OUTPUT) { deps.output.show(); } });
}

async function regenerate(deps: RegenerateDeps, running: Set<string>, node: FigureNode | undefined): Promise<void> {
  const session = deps.host.current();
  if (!session || node?.kind !== "figure") { return; }
  await executeSafely(session.logger, COMMAND, async () => {
    const key = `${node.project.folder}#${node.path}`;
    if (running.has(key)) {
      await vscode.window.showInformationMessage(`${node.path} is already being regenerated.`);
      return;
    }
    if (!await confirmFigureCommand(deps.context.workspaceState, node.project.folder, node.recipe.run)) { return; }
    running.add(key);
    try {
      deps.output.appendLine(`$ ${node.recipe.run}\n  in ${node.project.folder}`);
      await session.logger.log("INFO", MODULE, "figure command started", {
        project: node.project.settings.id, figure: node.path, command: node.recipe.run,
      });
      const started = Date.now();
      const result = await runWithProgress(deps, node);
      await reportOutcome(deps, session.logger, node, result, Date.now() - started);
    } finally {
      running.delete(key);
      deps.figures.refresh();
    }
  });
}

export function registerRegenerateFigure(deps: RegenerateDeps): void {
  const running = new Set<string>();
  deps.context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND, (node?: FigureNode) => regenerate(deps, running, node)),
  );
}
