// Declares the AI stores the service and indexer read and write, so a host supplies them with whatever storage it has.
import type { IFileSystem, ILogger, IVectorStore } from "@labshelf/core";

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
