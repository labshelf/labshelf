/** Asks for a DOI or link ("Add Paper by DOI or Link…") and imports the paper it names into papers/. */
import * as vscode from "vscode";

import { announceImport, queueTextLayersOfAdded, type ImportServices } from "./importProgress.js";

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
  queueTextLayersOfAdded(services, [outcome]);
  announceImport([outcome]);
}
