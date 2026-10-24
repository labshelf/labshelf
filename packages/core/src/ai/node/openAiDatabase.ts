// Opens the AI subsystem's own SQLite connection, migrates and ensures its schema; independent of the paper index.
import * as path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { IFileSystem, ILogger } from "../../ports/index.js";
import { ensureAiSchema } from "./aiSchema.js";
import { dropForeignKeyEmbeddings } from "./dropEmbeddingTables.js";

export async function openAiDatabase(databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">, logger: ILogger): Promise<DatabaseSync> {
  await fileSystem.ensureDir(path.dirname(databasePath));
  // PLATFORM: node:sqlite is behind a flag on Node 22.6, so it loads on first use, never when the barrel is imported.
  const { DatabaseSync } = await import("node:sqlite");
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA journal_mode = WAL");
  dropForeignKeyEmbeddings(connection, logger);
  ensureAiSchema(connection);
  return connection;
}
