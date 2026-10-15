// Registers the metadata commands: fetching, resolving missing fields, and deleting a paper.
import * as vscode from "vscode";

import { fetchMetadataForPaper, resolveMissingMetadata } from "../fetchMetadata.js";
import { removePapers } from "../removePapers.js";
import { resolvePaper } from "./paperResolution.js";
import { executeSafely, type RequireServices } from "./types.js";

export function registerMetadataCommands(context: vscode.ExtensionContext, requireServices: RequireServices): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.fetchMetadata", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.fetchMetadata", async () => {
        const paper = paperId
          ? (await services.paperService.listPapers()).find((entry) => entry.id === paperId)
          : await resolvePaper(services.paperService, undefined, "Select the paper to look up");
        if (!paper) { return; }
        await fetchMetadataForPaper(services.paperService, paper);
      });
    }),
    vscode.commands.registerCommand("labshelf.resolveMissingMetadata", async () => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.resolveMissingMetadata", async () => {
        await resolveMissingMetadata(services.paperService);
      });
    }),
    vscode.commands.registerCommand("labshelf.deletePaper", async (paperId?: string) => {
      const services = await requireServices();
      if (!services) { return; }
      await executeSafely(services.logger, "labshelf.deletePaper", async () => {
        const paper = await resolvePaper(services.paperService, paperId, "Remove paper from library");
        if (!paper) {
          return;
        }
        await removePapers(services.paperService, [paper]);
      });
    }),
  );
}
