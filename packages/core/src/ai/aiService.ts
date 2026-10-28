// Exposes the AI subsystem to UI, commands and services: the facade, its factory and the similar-papers query.
// INVARIANT: callers reach AI data only through this facade, never the database directly.
import type { PaperRecord } from "../model/index.js";
import type { PdfOpener } from "../import/pdf/index.js";
import type { ILogger, LocalFileSystem } from "../ports/index.js";
import { HashEmbeddingProvider } from "./embedding.js";
import type { IEmbeddingProvider, IVectorStore, VectorFilter, VectorMatch } from "./embedding.js";
import { AiIndexer, PdfTextExtractor } from "./ingestion.js";
import type { AiIndexerDeps, AiStorage, AiStores } from "./ingestion.js";

export interface AiServiceDependencies extends Pick<AiStores, "vectorStore"> {
  embedder: IEmbeddingProvider;
  indexer: AiIndexer;
}

export class AiService {
  constructor(private readonly deps: AiServiceDependencies) {}

  /**
   * Top-k semantic search across all indexed chunks.
   *
   * @returns Matches sorted by descending score.
   */
  async searchByText(query: string, k = 10, filter?: VectorFilter): Promise<VectorMatch[]> {
    return findTopK(query, this.deps.embedder, this.deps.vectorStore, {
      k,
      ...(filter ? { filter } : {}),
    });
  }

  /**
   * Triggers a full reindex of every paper in the library.
   *
   */
  async rebuildAll(): Promise<void> {
    await this.deps.indexer.rebuildAll();
  }
}

export interface AiServiceDeps extends Pick<AiIndexerDeps, "subscribe" | "resolvePdfPath"> {
  storage: AiStorage;
  listPapers: () => Promise<PaperRecord[]>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
  logger: ILogger;
  pdfOpener: PdfOpener;
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

// --- Similar papers ---

const CHUNKS_TO_SCAN = 40;
const MAX_PAPERS = 8;

/**
 * Ranks other papers by semantic similarity; an empty list when the AI index is not running.
 * @returns up to eight papers, most similar first
 */
export async function findSimilarPapers(
  ai: Pick<AiService, "searchByText"> | null,
  paper: PaperRecord,
): Promise<Array<{ paperId: string; score: number }>> {
  const query = [paper.title, paper.summary].filter(Boolean).join("\n");
  if (!ai || !query.trim()) { return []; }
  const matches = await ai.searchByText(query, CHUNKS_TO_SCAN, { excludePaperIds: [paper.id] });
  const best = new Map<string, number>();
  for (const match of matches) {
    if (match.paperId !== paper.id) { best.set(match.paperId, Math.max(best.get(match.paperId) ?? -Infinity, match.score)); }
  }
  return [...best]
    .map(([paperId, score]) => ({ paperId, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_PAPERS);
}

// Embeds a query and returns the vector store's top-k matches unchanged; the store owns filtering and ranking.
export interface RetrieveOptions {
  k?: number;
  filter?: VectorFilter;
}

/**
 * Retrieves the top-k most similar chunks for a free-text query.
 *
 * @returns Vector matches sorted by descending score.
 */
export async function findTopK(
  query: string,
  embedder: IEmbeddingProvider,
  store: IVectorStore,
  options: RetrieveOptions = {},
): Promise<VectorMatch[]> {
  const k = options.k ?? 10;
  const [embedding] = await embedder.embed([query]);
  if (!embedding) return [];
  return store.search(embedding, k, options.filter);
}
