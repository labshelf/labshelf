// Exposes the AI subsystem to UI, commands and services.
// INVARIANT: callers reach AI data only through this facade, never the database directly.
import type { AiIndexer } from "../indexer/index.js";
import { retrieveTopK } from "../rag/index.js";
import type { AiStores, IEmbeddingProvider, VectorFilter, VectorMatch } from "../types/index.js";

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
    return retrieveTopK(query, this.deps.embedder, this.deps.vectorStore, {
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
