// Watches the library for changes made outside this window and re-indexes from disk when one is seen.
// Also notices when the library folder disappears (unmounted drive, sync client) and re-arms when it returns.
import * as vscode from "vscode";

import { LibraryRootPresenceMonitor, formatError, createLibraryLayout, applyChangeBatch, type ConflictCopy, type ILogger } from "@labshelf/core";
import { ExternalChangeWatcher } from "../library/index.js";
import type { ActiveServices } from "../command/index.js";
import type { HostAdapters } from "./hostAdapters.js";

export interface ExternalChangeHandlingDeps {
  context: vscode.ExtensionContext;
  getActiveServices: () => ActiveServices | null;
  // Refreshes the Library sidebar and the open list panel once the re-index has settled.
  onRefresh: () => void;
  // Receives the unresolved conflict copies after every scan, including an empty list.
  onConflicts: (copies: ConflictCopy[]) => void;
  scanConflicts: HostAdapters["scanLibraryConflicts"];
}

async function folderExists(root: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(root);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "FileNotFound") { return false; }
    throw error;
  }
}

export class ExternalChangeHandling {
  private watcher: ExternalChangeWatcher | undefined;
  private monitor: LibraryRootPresenceMonitor | undefined;

  constructor(private readonly deps: ExternalChangeHandlingDeps) {
    deps.context.subscriptions.push({ dispose: () => this.stop() });
  }

  // Changes made outside this window (the LabShelf terminal app, a folder sync tool, another window) are picked up from
  // disk: the re-index adds, updates and drops papers, then the views refresh.
  watch(root: vscode.Uri): void {
    this.stop();
    const logger = this.deps.getActiveServices()?.logger;
    if (!logger) { return; }
    const onChange = (): void => { void this.processBatch(root, logger); };
    this.watcher = new ExternalChangeWatcher(createLibraryLayout(root, vscode.Uri.joinPath), onChange);
    this.monitor = new LibraryRootPresenceMonitor({
      exists: () => folderExists(root),
      logger,
      onLost: () => {
        this.watcher?.dispose();
        this.watcher = undefined;
        void vscode.window.showWarningMessage("Library folder not found");
      },
      onReturned: () => {
        this.watcher ??= new ExternalChangeWatcher(createLibraryLayout(root, vscode.Uri.joinPath), onChange);
        onChange();
      },
    });
    this.monitor.start();
    // The first scan reports copies a sync tool left while the library was closed.
    void this.deps.scanConflicts(root.fsPath, logger).then(this.deps.onConflicts, (error: unknown) => {
      void logger.log("WARN", "extension", "Conflict scan failed", { message: formatError(error) });
    });
  }

  private stop(): void {
    this.monitor?.stop();
    this.watcher?.dispose();
    this.monitor = undefined;
    this.watcher = undefined;
  }

  // Scans conflict copies and re-indexes from disk, then refreshes the views. The list panel, Library sidebar and AI
  // indexer update through the paper events the re-index emits.
  private async processBatch(root: vscode.Uri, logger: ILogger): Promise<void> {
    const monitor = this.monitor;
    const services = this.deps.getActiveServices();
    if (!monitor || !services) { return; }
    try {
      await applyChangeBatch({
        logger,
        isRootPresent: () => monitor.check(),
        scanConflicts: () => this.deps.scanConflicts(root.fsPath, logger),
        onConflicts: this.deps.onConflicts,
        reindex: async () => { await services.reindexLibrary(); },
      });
    } catch (error) {
      await logger.log("WARN", "extension", "Re-index after an external change failed", { message: formatError(error) });
      return;
    }
    this.deps.onRefresh();
  }
}
