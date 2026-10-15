// Exposes the AI subsystem to UI, commands and services.
// INVARIANT: callers reach AI data only through this facade, never the database directly.
import type { AiPaperMetadata, ClaimSearchResult, IEmbeddingProvider, ILogger, ReadingEvent, VectorFilter, VectorMatch } from "@labshelf/core";
import { retrieveTopK, searchByClaim as runSearchByClaim } from "@labshelf/core";
import type { AiStores } from "../ports.js";
import type { AiIndexer, IndexerQueue } from "../indexer/index.js";
import type { EventBus } from "../../events/index.js";

export interface AiServiceStatus {
  embeddingModelId: string;
  embeddingDimensions: number;
  queuedJobs: number;
  running: boolean;
}

export interface AiServiceDependencies extends AiStores {
  embedder: IEmbeddingProvider;
  indexer: AiIndexer;
  queue: IndexerQueue;
  eventBus: EventBus;
  logger: ILogger;
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
   * Stance-classified search for a claim sentence.
   *
   * @returns Per-paper results with support/contradict/neutral labels.
   */
  async searchByClaim(claim: string): Promise<ClaimSearchResult[]> {
    return runSearchByClaim(claim, this.deps.embedder, this.deps.vectorStore);
  }

  /**
   * Retrieves the cached AI metadata for a paper.
   *
   * @returns Metadata or null when the paper is not yet indexed.
   */
  getMetadata(paperId: string): AiPaperMetadata | null {
    return this.deps.metadataStore.get(paperId);
  }

  /**
   * Appends a reading event to the analytics store.
   *
   */
  recordReadingEvent(event: ReadingEvent): void {
    this.deps.readingEvents.append(event);
  }

  /**
   * Triggers a full reindex of every paper in the library.
   *
   */
  async rebuildAll(): Promise<void> {
    await this.deps.indexer.rebuildAll();
  }

  /**
   * Returns a snapshot of indexer status for the settings panel.
   *
   * @returns AiServiceStatus
   */
  status(): AiServiceStatus {
    return {
      embeddingModelId: this.deps.embedder.modelId,
      embeddingDimensions: this.deps.embedder.dimensions,
      queuedJobs: this.deps.queue.size(),
      running: this.deps.queue.isRunning(),
    };
  }
}
