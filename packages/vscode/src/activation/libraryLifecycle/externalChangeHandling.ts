// Watches the library for changes made outside this window and re-indexes from disk when one is seen.
import * as vscode from "vscode";

import { errorMessage, libraryLayout } from "@labshelf/core";
import { ExternalChangeWatcher } from "../../storage/data/index.js";
import type { ActiveServices } from "../../commands/index.js";

export interface ExternalChangeHandlingDeps {
  context: vscode.ExtensionContext;
  getActiveServices: () => ActiveServices | null;
  // Refreshes the tree and the open list panel once the re-index has settled.
  onRefresh: () => void;
}

export class ExternalChangeHandling {
  private watcher: ExternalChangeWatcher | undefined;

  constructor(private readonly deps: ExternalChangeHandlingDeps) {}

  // Changes made outside this window (the LabShelf terminal app, a sync it ran, another window) are picked up from
  // disk: the re-index adds, updates and drops papers, then the views refresh.
  watch(root: vscode.Uri): void {
    this.watcher?.dispose();
    this.watcher = new ExternalChangeWatcher(libraryLayout(root, vscode.Uri.joinPath), () => {
      void this.reindexAndRefresh("an external change");
    });
    this.deps.context.subscriptions.push(this.watcher);
  }

  // Re-indexes from disk and refreshes the views. The list panel, tree and AI
  // indexer update through the paper events the re-index emits. Shared by the
  // external-change watcher and a sync that pulled files in from Drive.
  async reindexAndRefresh(trigger: string): Promise<void> {
    const services = this.deps.getActiveServices();
    if (!services) { return; }
    try {
      await services.reindexLibrary();
    } catch (error) {
      await services.logger.log("WARN", "extension", `Re-index after ${trigger} failed`, {
        message: errorMessage(error),
      });
      return;
    }
    this.deps.onRefresh();
  }
}
