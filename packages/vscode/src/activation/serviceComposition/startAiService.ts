// Starts the AI subsystem for an already-built set of library services.
import * as vscode from "vscode";

import { createAiService, AiService } from "../../ai/service/index.js";
import type { ActiveServices } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";
import type { HostAdapters } from "./hostAdapters.js";

// Spins up the AI service when a library is configured. Resolution failures
// degrade the AI subsystem instead of breaking activation; the rest of the
// extension keeps working.
export async function startAiService(
  context: vscode.ExtensionContext,
  eventBus: EventBus,
  services: ActiveServices,
  adapters: HostAdapters,
): Promise<AiService | null> {
  try {
    const storage = await adapters.openAiStorage(services.aiDatabasePath, services.fileSystem, services.logger);
    const result = await createAiService({
      context,
      storage,
      listPapers: () => services.paperService.listPapers(),
      fileSystem: services.fileSystem,
      eventBus,
      logger: services.logger,
      pdfOpener: adapters.pdfOpener,
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
