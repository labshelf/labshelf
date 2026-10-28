// Ingests papers into the AI index: the storage ports, the PDF text extractor, the chunk-and-embed pipeline and the indexer that runs it per paper.
// Skips papers whose PDF content hash matches the last indexed run.
import type { PaperRecord } from "../model/index.js";
import type { ILogger, IFileSystem, LocalFileSystem } from "../ports/index.js";
import { deriveSha256Hex } from "../hash/index.js";
import { extractPageTexts } from "../import/pdf/index.js";
import type { PdfOpener } from "../import/pdf/index.js";
import { detectSections, splitBySection } from "./chunk.js";
import type { ExtractedPdfText, PaperChunk } from "./chunk.js";
import type { IEmbeddingProvider, IVectorStore, VectorEntry } from "./embedding.js";

// --- Storage ports ---

/** The content hash of each paper's PDF as last indexed, so unchanged files are not embedded again. */
export interface IIndexedHashes {
  get(paperId: string): string | null;
  set(paperId: string, hash: string): void;
  delete(paperId: string): void;
}

export interface AiStores {
  vectorStore: IVectorStore;
  hashes: IIndexedHashes;
}

/** An opened AI database; the vector rows are keyed by the model that embedded them, which is known later. */
export interface AiStorage {
  createStores(embeddingModelId: string): AiStores;
}

/** Opens (and creates) the AI database at a path. */
export type OpenAiStorage = (
  databasePath: string,
  fileSystem: Pick<IFileSystem, "ensureDir">,
  logger: ILogger,
) => Promise<AiStorage>;

// --- PDF text extraction ---

export class PdfTextExtractor {
  constructor(
    private readonly opener: PdfOpener,
    private readonly logger: ILogger,
  ) {}

  /**
   * Opens the PDF and returns its per-page text plus detected sections,
   * packaged for the @labshelf/core pipeline.
   *
   * @returns Extracted text with paperId metadata.
   */
  async extract(paperId: string, bytes: Uint8Array): Promise<ExtractedPdfText> {
    const document = await this.opener.open(bytes);
    try {
      const pages = await extractPageTexts(document, document.numPages, this.logger);
      return { paperId, pages, sections: detectSections(pages) };
    } finally {
      try {
        await document.destroy();
      } catch (error) {
        await this.logger.error("ai/pdf", error, { paperId, message: "PDF cleanup failed" });
      }
    }
  }
}

// --- Pipeline ---

export interface IngestionContext {
  embedder?: IEmbeddingProvider;
  vectorStore?: IVectorStore;
}

export interface IngestionResult {
  paperId: string;
  chunkCount: number;
  embeddedChunks: number;
}

/**
 * Runs the ingestion pipeline end-to-end for a single paper.
 *
 * @returns Counts of the chunks produced and embedded.
 */
export async function runIngestion(
  extracted: ExtractedPdfText,
  context: IngestionContext,
): Promise<IngestionResult> {
  const chunks = splitBySection(extracted);
  const embeddedChunks = await embedAndStore(chunks, context);
  return {
    paperId: extracted.paperId,
    chunkCount: chunks.length,
    embeddedChunks,
  };
}

async function embedAndStore(
  chunks: PaperChunk[],
  context: IngestionContext,
): Promise<number> {
  if (!context.embedder || !context.vectorStore || chunks.length === 0) return 0;
  const texts = chunks.map((c) => c.text);
  const embeddings = await context.embedder.embed(texts);
  const payload = chunks
    .map((chunk, idx) => {
      const embedding = embeddings[idx];
      if (!embedding) return null;
      const record: VectorEntry = {
        id: 0,
        paperId: chunk.paperId,
        kind: chunk.kind,
        text: chunk.text,
        ...(chunk.section !== undefined ? { section: chunk.section } : {}),
        ...(chunk.page !== undefined ? { page: chunk.page } : {}),
      };
      return { record, embedding };
    })
    .filter((p): p is { record: VectorEntry; embedding: Float32Array } => p !== null);
  await context.vectorStore.upsert(payload);
  return payload.length;
}

// --- Indexer ---

export interface AiIndexerDeps {
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

  constructor(private readonly deps: AiIndexerDeps) {}

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
      const hash = await deriveSha256Hex(bytes);
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
