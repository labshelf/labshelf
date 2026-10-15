// Opens the AI subsystem's own SQLite connection, migrates and ensures its schema; independent of the paper index.
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IFileSystem, ILogger } from "@labshelf/core";
import { ensureAiSchema } from "./aiSchema.js";
import { dropForeignKeyEmbeddings } from "./migrations/index.js";

export async function openAiDatabase(databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">, logger: ILogger): Promise<DatabaseSync> {
  await fileSystem.ensureDir(path.dirname(databasePath));
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA journal_mode = WAL");
  dropForeignKeyEmbeddings(connection, logger);
  ensureAiSchema(connection);
  return connection;
}
