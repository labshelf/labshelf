// Builds the AI service from the extension's storage, library events and logger.
// Returns null when AI is disabled in settings.
import * as vscode from "vscode";
import type { ILogger, LocalFileSystem, PaperRecord, PdfDocumentOpener } from "@labshelf/core";
import type { AiStorage } from "../ports.js";
import { PdfTextExtractor } from "../pdf/index.js";
import { HashEmbeddingProvider } from "../runtime/index.js";
import { AiIndexer } from "../indexer/index.js";
import { AiService } from "./aiService.js";
import type { LibraryEvents } from "../../events/index.js";

export interface AiServiceFactoryDependencies {
  context: vscode.ExtensionContext;
  storage: AiStorage;
  listPapers: () => Promise<PaperRecord[]>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  events: LibraryEvents;
  logger: ILogger;
  pdfOpener: PdfDocumentOpener;
  resolvePdfUri: (paperId: string) => Promise<vscode.Uri | null>;
}

/**
 * Builds the AiService graph. Caller must dispose the indexer when activation
 * is torn down (returned in `dispose`).
 */
export async function createAiService(
  deps: AiServiceFactoryDependencies,
): Promise<{ service: AiService; dispose: () => void } | null> {
  const config = vscode.workspace.getConfiguration("labshelf.ai");
  if (config.get<boolean>("enabled") === false) return null;

  const embedder = new HashEmbeddingProvider();
  const { vectorStore, hashes } = deps.storage.createStores(embedder.modelId);
  const extractor = new PdfTextExtractor(deps.pdfOpener, deps.logger);
  const indexer = new AiIndexer({
    listPapers: deps.listPapers,
    events: deps.events,
    logger: deps.logger,
    embedder,
    vectorStore,
    hashes,
    extractor,
    resolvePdfUri: deps.resolvePdfUri,
    fileSystem: deps.fileSystem,
  });
  const detach = indexer.attach();
  const service = new AiService({ embedder, vectorStore, indexer });
  return { service, dispose: detach };
}
