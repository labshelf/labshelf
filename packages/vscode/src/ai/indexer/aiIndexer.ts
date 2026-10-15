// Ingests added or updated papers into the AI index, one paper at a time.
// Skips papers whose PDF content hash matches the last indexed run.
import * as vscode from "vscode";
import type { IEmbeddingProvider, ILogger, IVectorStore, LocalFileSystem, PaperRecord } from "@labshelf/core";
import { runIngestion, sha256Hex } from "@labshelf/core";
import type { IIndexedHashes } from "../ports.js";
import type { PdfTextExtractor } from "../pdf/index.js";
import type { LibraryEvents } from "../../events/index.js";

export interface AiIndexerDependencies {
  listPapers: () => Promise<PaperRecord[]>;
  events: LibraryEvents;
  logger: ILogger;
  embedder: IEmbeddingProvider;
  vectorStore: IVectorStore;
  hashes: IIndexedHashes;
  extractor: PdfTextExtractor;
  // Async because a paper's folder is only known to the index: papers live in any collection folder under papers/.
  resolvePdfUri: (paperId: string) => Promise<vscode.Uri | null>;
  fileSystem: Pick<LocalFileSystem, "readFile">;
}

export class AiIndexer {
  // PLATFORM: embedding is CPU-bound, so one job runs at a time; parallel pipelines would only thrash the model.
  // INVARIANT: a job never rejects, so one failure cannot stall the jobs behind it.
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly deps: AiIndexerDependencies) {}

  /**
   * Subscribes to paper lifecycle events. Returns a disposer that detaches the
   * listeners — the caller should add it to the extension context.
   *
   * @returns Function that unsubscribes the indexer.
   */
  attach(): () => void {
    const subscriptions = vscode.Disposable.from(
      this.deps.events.paperAdded.event((paper) => this.scheduleByPayload(paper)),
      this.deps.events.paperUpdated.event((paper) => this.scheduleByPayload(paper)),
      this.deps.events.paperDeleted.event((paper) => this.scheduleDelete(paper)),
    );
    return () => subscriptions.dispose();
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

  private scheduleByPayload(payload: unknown): void {
    const paperId = readPaperId(payload);
    if (paperId) this.schedule(() => this.runIndex(paperId));
  }

  private scheduleDelete(payload: unknown): void {
    const paperId = readPaperId(payload);
    if (paperId) this.schedule(() => this.runDelete(paperId));
  }

  private async runIndex(paperId: string): Promise<void> {
    try {
      const pdfUri = await this.deps.resolvePdfUri(paperId);
      if (!pdfUri) return;
      const bytes = await this.deps.fileSystem.readFile(pdfUri.fsPath);
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

function readPaperId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const id = (payload as { paperId?: unknown; id?: unknown }).paperId
    ?? (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}
