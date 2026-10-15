// Ingests added or updated papers into the AI index, one paper at a time.
// Skips papers whose PDF content hash matches the last indexed run.
import type { PaperRecord } from "../../model/index.js";
import type { ILogger, LocalFileSystem } from "../../ports/index.js";
import { sha256Hex } from "../../sync/util/index.js";
import { runIngestion } from "../pipeline/index.js";
import type { PdfTextExtractor } from "../pipeline/index.js";
import type { IEmbeddingProvider, IIndexedHashes, IVectorStore } from "../types/index.js";

export interface AiIndexerDependencies {
  listPapers: () => Promise<PaperRecord[]>;
  // Wires the host's paper lifecycle events to the indexer; the returned function detaches them.
  subscribe: (onUpsert: (paperId: string) => void, onRemove: (paperId: string) => void) => () => void;
  logger: ILogger;
  embedder: IEmbeddingProvider;
  vectorStore: IVectorStore;
  hashes: IIndexedHashes;
  extractor: PdfTextExtractor;
  // Async because a paper's folder is only known to the index: papers live in any collection folder under papers/.
  resolvePdfPath: (paperId: string) => Promise<string | null>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
}

export class AiIndexer {
  // PLATFORM: embedding is CPU-bound, so one job runs at a time; parallel pipelines would only thrash the model.
  // INVARIANT: a job never rejects, so one failure cannot stall the jobs behind it.
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AiIndexerDependencies) {}

  /**
   * Subscribes to paper lifecycle events.
   *
   * @returns Function that unsubscribes the indexer.
   */
  attach(): () => void {
    return this.deps.subscribe(
      (paperId) => this.schedule(() => this.runIndex(paperId)),
      (paperId) => this.schedule(() => this.runDelete(paperId)),
    );
  }

  /**
   * Re-runs ingestion for every known paper. Used by the rebuild command.
   * Resolves once every queued job, including earlier ones, has finished.
   */
  async rebuildAll(): Promise<void> {
    const papers = await this.deps.listPapers();
    for (const paper of papers) this.schedule(() => this.runIndex(paper.id));
    await this.tail;
  }

  private schedule(job: () => Promise<void>): void {
    this.tail = this.tail.then(job);
  }

  private async runIndex(paperId: string): Promise<void> {
    try {
      const pdfPath = await this.deps.resolvePdfPath(paperId);
      if (!pdfPath) return;
      const bytes = await this.deps.fileSystem.readFile(pdfPath);
      const hash = await sha256Hex(bytes);
      if (this.deps.hashes.get(paperId) === hash) return;
      const extracted = await this.deps.extractor.extract(paperId, bytes);
      await runIngestion(extracted, { embedder: this.deps.embedder, vectorStore: this.deps.vectorStore });
      this.deps.hashes.set(paperId, hash);
    } catch (error) {
      await this.deps.logger.error("ai/indexer", error, { paperId });
    }
  }

  // The hash goes first: a hash left without its vectors would make a later re-add skip indexing.
  private async runDelete(paperId: string): Promise<void> {
    try {
      this.deps.hashes.delete(paperId);
      await this.deps.vectorStore.deleteByPaper(paperId);
    } catch (error) {
      await this.deps.logger.error("ai/indexer", error, { paperId });
    }
  }
}
