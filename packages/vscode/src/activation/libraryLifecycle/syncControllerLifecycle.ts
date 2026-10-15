// Owns the single SyncController instance, creating it on first use and pointing it at a new root afterwards.
import * as vscode from "vscode";

import { libraryLayout, type SyncResult } from "@labshelf/core";
import { SyncController } from "../../sync/adapter/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";
import type { ActiveServices } from "../../commands/index.js";
import type { LibraryEvents } from "../../events/index.js";

export interface SyncControllerLifecycleDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  adapters: HostAdapters;
  getActiveServices: () => ActiveServices | null;
  onSynced: (result: SyncResult) => Promise<void>;
}

export class SyncControllerLifecycle {
  private controller: SyncController | null = null;

  constructor(private readonly deps: SyncControllerLifecycleDeps) {}

  current(): SyncController | null {
    return this.controller;
  }

  // Creates the sync controller once, wiring the post-sync re-index. A sync that
  // pulls files from Drive must surface in the list without a reload, so the
  // controller's onDidSync triggers the re-index.
  async ensure(root: vscode.Uri, services: ActiveServices): Promise<void> {
    const fileSystem = services.fileSystem;
    if (this.controller) {
      this.controller.setLibrary(libraryLayout(root, vscode.Uri.joinPath), fileSystem, services.logger);
      return;
    }
    const controller = new SyncController({
      createAuth: (logger) => this.deps.adapters.sync.createDriveAuth(logger),
      host: this.deps.adapters.sync.host,
      lock: this.deps.adapters.sync.lock,
      paths: libraryLayout(root, vscode.Uri.joinPath),
      localFs: fileSystem,
      events: this.deps.events,
      logger: services.logger,
      listTitles: async () =>
        (await this.deps.getActiveServices()!.paperService.listPapers()).map((p) => [p.id, p.title] as const),
    });
    controller.onDidSync((result) => { void this.deps.onSynced(result); });
    await controller.initialize();
    this.deps.context.subscriptions.push(controller);
    this.controller = controller;
  }
}
