// Opens the on-disk research database, falling back to an in-memory one when SQLite is unavailable.
import * as vscode from "vscode";

import { InMemoryResearchDatabase, type IFileSystem, type IResearchDatabase } from "@labshelf/core";

// Tries to create the SQLite database; falls back to the in-memory implementation on failure.
export async function openLibraryDatabase(indexPath: vscode.Uri, fileSystem: IFileSystem): Promise<IResearchDatabase> {
  try {
    const { createSqliteResearchDatabase } = await import("../../db/sqliteResearchDatabase.js");
    const database = await createSqliteResearchDatabase(indexPath, fileSystem);
    await database.initialize();
    return database;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`LabShelf SQLite unavailable, using in-memory fallback: ${message}`);
    const fallback = new InMemoryResearchDatabase();
    await fallback.initialize();
    return fallback;
  }
}
