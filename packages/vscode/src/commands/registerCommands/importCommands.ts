// Registers the commands that bring new papers into the library: file import and lookup by identifier.
import * as vscode from "vscode";

import { addPaperByIdentifier } from "../addByIdentifier.js";
import { importPapers } from "../importProgress.js";
import { executeSafely, type RequireServices } from "./types.js";

export function registerImportCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.addPaper", async () => {
        const selected = await vscode.window.showOpenDialog({
          canSelectMany: true,
          canSelectFiles: true,
          canSelectFolders: true,
          filters: { PDF: ["pdf"] },
          openLabel: "Add Paper",
        });

        if (!selected || selected.length === 0) {
          return;
        }

        await importPapers(services, selected);
      });
    }),
    vscode.commands.registerCommand("labshelf.addPaperByIdentifier", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.addPaperByIdentifier", () => addPaperByIdentifier(services));
    }),
  );
}
