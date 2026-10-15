// Starts the AI subsystem for an already-built set of library services.
import * as vscode from "vscode";

import { createAiService, errorMessage } from "@labshelf/core";
import type { AiService } from "@labshelf/core";

import type { ActiveServices } from "../../commands/index.js";
import type { LibraryEvents } from "../../events/index.js";
import type { HostAdapters } from "./hostAdapters.js";

// Spins up the AI service when a library is configured and AI is enabled in settings. Resolution failures
// degrade the AI subsystem instead of breaking activation; the rest of the
// extension keeps working.
export async function startAiService(
  context: vscode.ExtensionContext,
  events: LibraryEvents,
  services: ActiveServices,
  adapters: HostAdapters,
): Promise<AiService | null> {
  if (vscode.workspace.getConfiguration("labshelf.ai").get<boolean>("enabled") === false) return null;
  try {
    const storage = await adapters.openAiStorage(services.aiDatabasePath, services.fileSystem, services.logger);
    const result = createAiService({
      storage,
      listPapers: () => services.paperService.listPapers(),
      fileSystem: services.fileSystem,
      logger: services.logger,
      pdfOpener: adapters.pdfOpener,
      resolvePdfPath: (paperId) => services.paperService.resolvePdfPath(paperId),
      subscribe: (onUpsert, onRemove) => {
        const subscriptions = vscode.Disposable.from(
          events.paperAdded.event((paper) => onUpsert(paper.id)),
          events.paperUpdated.event((paper) => onUpsert(paper.id)),
          events.paperDeleted.event((paper) => onRemove(paper.id)),
        );
        return () => subscriptions.dispose();
      },
    });
    context.subscriptions.push({ dispose: result.dispose });
    return result.service;
  } catch (error) {
    void services.logger.log("WARN", "extension", "AI service failed to start", {
      message: errorMessage(error),
    });
    return null;
  }
}
