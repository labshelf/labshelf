// Registers the commands that bring new papers into the library: file import and lookup by identifier.
import * as vscode from "vscode";

import {
  importPapersFromDialog,
  reportImport,
  addTextLayersOfAdded,
  type ImportServices,
} from "./importProgress.js";
import { runSafely, type EnsureServices } from "./commandContext.js";

/** Does nothing when the person cancels the input. */
export async function addPaperByIdentifier(
  services: Pick<ImportServices, "importer" | "textLayers" | "logger">,
): Promise<void> {
  const input = await vscode.window.showInputBox({
    prompt: "DOI, arXiv id, PubMed id, or a link to an article or a PDF",
    placeHolder: "10.1038/nature12373, arXiv:1706.03762 or https://…",
    ignoreFocusOut: true,
  });
  if (!input?.trim()) { return; }
  // The download and the registry lookups can take many seconds.
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "LabShelf", cancellable: false },
    async (progress) => {
      progress.report({ message: "Looking the paper up and downloading its PDF…" });
      return services.importer.importFromNetwork(input.trim());
    },
  );
  addTextLayersOfAdded(services, [outcome]);
  reportImport([outcome]);
}

export function registerImportCommands(context: vscode.ExtensionContext, requireServices: EnsureServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.addPaper", () => importPapersFromDialog(services));
    }),
    vscode.commands.registerCommand("labshelf.addPaperByIdentifier", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await runSafely(services.logger, "labshelf.addPaperByIdentifier", () => addPaperByIdentifier(services));
    }),
  );
}
