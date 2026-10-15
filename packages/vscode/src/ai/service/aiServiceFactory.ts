/**
 * Wires the AI subsystem together from the dependencies that extension.ts
 * already constructs (its own SQLite connection, event bus, logger, paths).
 * Returns null when AI is disabled in settings. Embeddings come from the
 * hash provider.
 */
import * as vscode from "vscode";
import { DatabaseSync } from "node:sqlite";
import type { ILogger, LocalFileSystem, PaperRecord, PdfDocumentOpener } from "@labshelf/core";
import { AiMetadataStore, ReadingEventsStore, SqliteVectorStore } from "../../db/ai/index.js";
import { PdfTextExtractor } from "../pdf/pdfTextExtractor.js";
import { HashEmbeddingProvider } from "../runtime/index.js";
import { AiIndexer } from "../indexer/aiIndexer.js";
import { IndexerQueue } from "../indexer/indexerQueue.js";
import { AiService } from "./aiService.js";
import type { EventBus } from "../../events/index.js";

export interface AiServiceFactoryDependencies {
  context: vscode.ExtensionContext;
  connection: DatabaseSync;
  listPapers: () => Promise<PaperRecord[]>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  eventBus: EventBus;
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
  const vectorStore = new SqliteVectorStore(deps.connection, embedder.modelId);
  const metadataStore = new AiMetadataStore(deps.connection);
  const readingEvents = new ReadingEventsStore(deps.connection);
  const extractor = new PdfTextExtractor(deps.pdfOpener, deps.fileSystem);
  const queue = new IndexerQueue(deps.logger);
  const indexer = new AiIndexer({
    listPapers: deps.listPapers,
    eventBus: deps.eventBus,
    logger: deps.logger,
    embedder,
    vectorStore,
    metadataStore,
    extractor,
    resolvePdfUri: deps.resolvePdfUri,
    fileSystem: deps.fileSystem,
    enqueue: (job) => queue.enqueue(job),
  });
  const detach = indexer.attach();
  const service = new AiService({
    embedder,
    vectorStore,
    metadataStore,
    readingEvents,
    indexer,
    queue,
    eventBus: deps.eventBus,
    logger: deps.logger,
  });
  return { service, dispose: detach };
}
