// Registers the commands that bring new papers into the library: file import and lookup by identifier.
import * as vscode from "vscode";

import { addPaperByIdentifier } from "../addByIdentifier.js";
import { importPapersFromDialog } from "../importProgress.js";
import { executeSafely, type RequireServices } from "./types.js";

export function registerImportCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.addPaper", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.addPaper", () => importPapersFromDialog(services));
    }),
    vscode.commands.registerCommand("labshelf.addPaperByIdentifier", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.addPaperByIdentifier", () => addPaperByIdentifier(services));
    }),
  );
}
