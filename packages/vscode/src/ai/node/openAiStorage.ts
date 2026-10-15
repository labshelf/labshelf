// Opens the AI database in SQLite and builds the stores over its one connection.
import type { OpenAiStorage } from "../ports.js";
import { SqliteIndexedHashes } from "./indexedHashes.js";
import { openAiDatabase } from "./openAiDatabase.js";
import { SqliteVectorStore } from "./sqliteVectorStore.js";

export const openAiStorage: OpenAiStorage = async (databasePath, fileSystem) => {
  const connection = await openAiDatabase(databasePath, fileSystem);
  return {
    createStores: (embeddingModelId) => ({
      vectorStore: new SqliteVectorStore(connection, embeddingModelId),
      hashes: new SqliteIndexedHashes(connection),
    }),
  };
};
