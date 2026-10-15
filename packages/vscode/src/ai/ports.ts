// Declares the AI stores the service and indexer read and write, so a host supplies them with whatever storage it has.
import type { AiPaperMetadata, IFileSystem, IVectorStore, ReadingEvent } from "@labshelf/core";

/** Per-paper AI metadata and the content hash of the PDF it was derived from. */
export interface IAiMetadataStore {
  get(paperId: string): AiPaperMetadata | null;
  upsert(metadata: AiPaperMetadata, contentHash?: string): void;
  /** @returns every indexed paper id with the hash its metadata was derived from */
  listIndexed(): Map<string, string | null>;
  delete(paperId: string): void;
}

/** Where the reading analytics land. */
interface IReadingEventsStore {
  append(event: ReadingEvent): void;
}

export interface AiStores {
  vectorStore: IVectorStore;
  metadataStore: IAiMetadataStore;
  readingEvents: IReadingEventsStore;
}

/** An opened AI database; the vector rows are keyed by the model that embedded them, which is known later. */
export interface AiStorage {
  createStores(embeddingModelId: string): AiStores;
}

/** Opens (and creates) the AI database at a path. */
export type OpenAiStorage = (databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">) => Promise<AiStorage>;
