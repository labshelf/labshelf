// Starts the AI subsystem for an already-built set of library services.
import * as vscode from "vscode";

import { NodePdfOpener } from "@labshelf/core/node";
import { createAiService, AiService } from "../../ai/service/index.js";
import { openAiDatabase } from "../../db/ai/index.js";
import { hostPdfjs } from "../../pdf/index.js";
import type { ActiveServices } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";

// Spins up the AI service when a library is configured. Resolution failures
// degrade the AI subsystem instead of breaking activation; the rest of the
// extension keeps working.
export async function startAiService(
  context: vscode.ExtensionContext,
  eventBus: EventBus,
  services: ActiveServices,
): Promise<AiService | null> {
  try {
    const connection = await openAiDatabase(services.aiDatabasePath, services.fileSystem);
    const result = await createAiService({
      context,
      connection,
      listPapers: () => services.paperService.listPapers(),
      fileSystem: services.fileSystem,
      eventBus,
      logger: services.logger,
      pdfOpener: new NodePdfOpener(hostPdfjs),
      resolvePdfUri: (paperId) => services.paperService.resolvePdfUri(paperId),
    });
    if (!result) return null;
    context.subscriptions.push({ dispose: result.dispose });
    return result.service;
  } catch (error) {
    void services.logger.log("WARN", "extension", "AI service failed to start", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
