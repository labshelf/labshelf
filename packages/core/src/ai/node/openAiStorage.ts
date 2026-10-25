// Opens the AI database in SQLite and builds the stores over its one connection.
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { OpenAiStorage } from "../aiStorage.js";
import { SqliteIndexedHashes } from "./indexedHashes.js";
import { SqliteVectorStore } from "./sqliteVectorIndex.js";
import type { IFileSystem, ILogger } from "../../ports/index.js";
import { ensureAiSchema } from "./aiSchema.js";

// The index is a local cache: dropping rows only makes the indexer embed every paper again.
// TRAP: indexes older than the hash table have chunk_embeddings but no indexed_papers.
function dropForeignKeyEmbeddings(db: DatabaseSync, logger: ILogger): void {
  const references = db.prepare("PRAGMA foreign_key_list(chunk_embeddings)").all();
  if (references.length === 0) return;
  db.exec("DROP TABLE chunk_embeddings; DROP TABLE IF EXISTS indexed_papers;");
  void logger.log("INFO", "ai", "Dropped embeddings tied to the old papers table; papers will be indexed again", {
    droppedTables: ["chunk_embeddings", "indexed_papers"],
  });
}

async function openAiDatabase(databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">, logger: ILogger): Promise<DatabaseSync> {
  await fileSystem.ensureDir(path.dirname(databasePath));
  // PLATFORM: node:sqlite is behind a flag on Node 22.6, so it loads on first use, never when the barrel is imported.
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA journal_mode = WAL");
  dropForeignKeyEmbeddings(connection, logger);
  ensureAiSchema(connection);
  return connection;
}

export const openAiStorage: OpenAiStorage = async (databasePath, fileSystem, logger) => {
  const connection = await openAiDatabase(databasePath, fileSystem, logger);
  return {
    createStores: (embeddingModelId) => ({
      vectorStore: new SqliteVectorStore(connection, embeddingModelId),
      hashes: new SqliteIndexedHashes(connection),
    }),
  };
};
