// Declares what the command-registration groups share: the services a command needs and how to fetch them.
// Also provides executeSafely, the error-handling wrapper every group's commands run through.
import * as vscode from "vscode";

import type { PaperImporter, PaperTextLayers, RefreshLibraryResult } from "../library/index.js";
import { formatError, type PaperNotesStore, type PaperSidecarStore, type LibraryFileSystem, type ILogger, type LibraryStore, type MutationContext, type PaperService } from "@labshelf/core";

const LOG_MODULE = "command";

export type ActiveServices = {
  paperService: PaperService;
  importer: PaperImporter;
  textLayers: PaperTextLayers;
  // The ports every core library mutation runs over, for this library root.
  mutations: MutationContext;
  logger: ILogger;
  library: LibraryStore;
  paperDataStore: PaperSidecarStore;
  paperNotesStore: PaperNotesStore;
  // The adapter of this library root; its temp folder for atomic writes is inside the root.
  fileSystem: LibraryFileSystem;
  // Rebuilds the index from disk and emits the resulting paper events. Bound in
  // extension.ts over the live store, file system and library events.
  reindexLibrary: () => Promise<RefreshLibraryResult>;
  // Where the AI subsystem's own SQLite file lives for this library root; startAiService opens it lazily,
  // inside its own try/catch, so a failure there degrades the AI subsystem instead of breaking activation.
  aiDatabasePath: string;
  // The OpenAlex cache the citation map reads and fills.
  citationCacheDir: string;
};

export type EnsureServices = () => Promise<ActiveServices | null>;

// Wraps an async command action with error logging and a user-facing error message on failure.
export async function runSafely(logger: ILogger, commandName: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    await logger.error(LOG_MODULE, error, { commandName });
    const message = formatError(error);
    await vscode.window.showErrorMessage(`LabShelf command failed: ${message}`);
  }
}
