// Opens the AI subsystem's own SQLite connection and ensures its schema; independent of the paper index.
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { IFileSystem } from "@labshelf/core";
import { ensureAiSchema } from "./aiSchema.js";

export async function openAiDatabase(databasePath: string, fileSystem: Pick<IFileSystem, "ensureDir">): Promise<DatabaseSync> {
  await fileSystem.ensureDir(path.dirname(databasePath));
  const connection = new DatabaseSync(databasePath);
  connection.exec("PRAGMA journal_mode = WAL");
  ensureAiSchema(connection);
  return connection;
}
