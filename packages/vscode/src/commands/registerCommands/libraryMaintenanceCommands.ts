// Registers the library-wide maintenance commands: regenerating BibTeX, rebuilding the index, and opening the sidebar.
import * as vscode from "vscode";

import { executeSafely, type RequireServices } from "./types.js";

export function registerMaintenanceCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.generateBibTeX", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.generateBibTeX", async () => {
        const regeneratedCount = await services.paperService.regenerateBibTeX();
        await vscode.window.showInformationMessage(`Regenerated BibTeX for ${regeneratedCount} paper(s).`);
      });
    }),
    vscode.commands.registerCommand("labshelf.rebuildIndex", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.rebuildIndex", async () => {
        const summary = await services.reindexLibrary();
        const changed = summary.added.length + summary.updated.length + summary.removed.length;
        void vscode.window.showInformationMessage(
          changed > 0
            ? `LabShelf: index rebuilt — ${summary.added.length} added, ${summary.updated.length} updated, ${summary.removed.length} removed.`
            : "LabShelf: index rebuilt; nothing changed.",
        );
      });
    }),
    vscode.commands.registerCommand("labshelf.openSidebar", async () => {
      await vscode.commands.executeCommand("workbench.view.extension.labshelfContainer");
    }),
  );
}
