// Builds the AI service from the host's storage, paper lifecycle subscription and logger.
import type { PdfDocumentOpener } from "../../import/pdf/index.js";
import type { PaperRecord } from "../../model/index.js";
import type { ILogger, LocalFileSystem } from "../../ports/index.js";
import { HashEmbeddingProvider } from "../embedding/index.js";
import { AiIndexer } from "../aiIndexer.js";
import type { AiIndexerDeps } from "../aiIndexer.js";
import type { AiStorage } from "../aiStorage.js";
import { PdfTextExtractor } from "../pdfTextExtractor.js";
import { AiService } from "./aiService.js";

export interface AiServiceDeps extends Pick<AiIndexerDeps, "subscribe" | "resolvePdfPath"> {
  storage: AiStorage;
  listPapers: () => Promise<PaperRecord[]>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  logger: ILogger;
  pdfOpener: PdfDocumentOpener;
}

/**
 * Builds the AiService graph. Caller must call `dispose` when activation is torn down, to detach the indexer.
 */
export function createAiService(deps: AiServiceDeps): { service: AiService; dispose: () => void } {
  const embedder = new HashEmbeddingProvider();
  const { vectorStore, hashes } = deps.storage.createStores(embedder.modelId);
  const extractor = new PdfTextExtractor(deps.pdfOpener, deps.logger);
  const indexer = new AiIndexer({
    listPapers: deps.listPapers,
    subscribe: deps.subscribe,
    logger: deps.logger,
    embedder,
    vectorStore,
    hashes,
    extractor,
    resolvePdfPath: deps.resolvePdfPath,
    fileSystem: deps.fileSystem,
  });
  const detach = indexer.attach();
  const service = new AiService({ embedder, vectorStore, indexer });
  return { service, dispose: detach };
}
