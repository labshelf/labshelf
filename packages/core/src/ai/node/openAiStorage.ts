// Opens the AI database in SQLite and builds the stores over its one connection.
import type { OpenAiStorage } from "../aiStorage.js";
import { SqliteIndexedHashes } from "./indexedHashes.js";
import { openAiDatabase } from "./openAiDatabase.js";
import { SqliteVectorStore } from "./sqliteVectorIndex.js";

export const openAiStorage: OpenAiStorage = async (databasePath, fileSystem, logger) => {
  const connection = await openAiDatabase(databasePath, fileSystem, logger);
  return {
    createStores: (embeddingModelId) => ({
      vectorStore: new SqliteVectorStore(connection, embeddingModelId),
      hashes: new SqliteIndexedHashes(connection),
    }),
  };
};
