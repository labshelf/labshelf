// Types shared by the command-registration groups: the services a command needs and how to fetch
// them, plus executeSafely, the error-handling wrapper every group's commands run through.
import * as vscode from "vscode";

import type { PaperImporter, PaperService, PaperTextLayers } from "../../core/index.js";
import type { ThemeManager } from "../../pdf-viewer/index.js";
import { type PaperDataStore, type IFileSystem, type ILogger, type IResearchDatabase, type LocalFileSystem, type MutationContext } from "@labshelf/core";
import type { ReindexSummary } from "../../storage/data/reindexLibrary.js";
import type { FolderReader } from "../../ui/library/index.js";

const LOG_MODULE = "commands/registerCommands";

export type ActiveServices = {
  paperService: PaperService;
  importer: PaperImporter;
  textLayers: PaperTextLayers;
  // The ports every core library mutation runs over, for this library root.
  mutations: MutationContext;
  logger: ILogger;
  themeManager: ThemeManager;
  database: IResearchDatabase;
  paperDataStore: PaperDataStore;
  // The adapter of this library root; its temp folder for atomic writes is inside the root.
  fileSystem: IFileSystem & LocalFileSystem;
  // Rebuilds the index from disk and emits the resulting paper events. Bound in
  // extension.ts over the live database, file system and event bus.
  reindexLibrary: () => Promise<ReindexSummary>;
  // Lists the collection folders of this library root for the tree and the list panel.
  folderReader: FolderReader;
};

export type RequireServices = () => Promise<ActiveServices | null>;

// Wraps an async command action with error logging and a user-facing error message on failure.
export async function executeSafely(logger: ILogger, commandName: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    await logger.error(LOG_MODULE, error, { commandName });
    const message = error instanceof Error ? error.message : String(error);
    await vscode.window.showErrorMessage(`LabShelf command failed: ${message}`);
  }
}
