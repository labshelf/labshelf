// Owns the active library root and its built services, rebuilding both through one path whether the root
// comes from the setup wizard or from a saved setting.
import * as vscode from "vscode";

import { runLibrarySetupWizard, mirrorLibraryRoot } from "../../storage/paths/index.js";
import { buildServices, createFileSystem, type HostAdapters } from "../serviceComposition/index.js";
import type { ActiveServices } from "../../commands/index.js";
import type { EventBus } from "../../events/index.js";
import { ExternalChangeHandling } from "./externalChangeHandling.js";
import { SyncControllerLifecycle } from "./syncControllerLifecycle.js";

export interface LibraryRootChange {
  root: vscode.Uri;
  services: ActiveServices;
}

export class LibraryRootController {
  private root: vscode.Uri | undefined;
  private activeServices: ActiveServices | null = null;
  private readonly changeEmitter = new vscode.EventEmitter<LibraryRootChange>();
  readonly onDidChangeRoot = this.changeEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly eventBus: EventBus,
    private readonly externalChangeHandling: ExternalChangeHandling,
    private readonly syncLifecycle: SyncControllerLifecycle,
    private readonly adapters: HostAdapters,
  ) {
    context.subscriptions.push(this.changeEmitter);
  }

  currentRoot(): vscode.Uri | undefined {
    return this.root;
  }

  currentServices(): ActiveServices | null {
    return this.activeServices;
  }

  syncController() {
    return this.syncLifecycle.current();
  }

  // Returns the current services or triggers the setup wizard and builds services from the chosen root.
  async require(): Promise<ActiveServices | null> {
    if (this.activeServices) {
      return this.activeServices;
    }
    const root = await runLibrarySetupWizard(this.context, (target) => createFileSystem(target, this.adapters.paths));
    if (!root) {
      return null;
    }
    return this.applyRoot(root);
  }

  // Always runs the setup wizard, even when a library is already configured.
  async reconfigure(): Promise<ActiveServices | null> {
    const root = await runLibrarySetupWizard(this.context, (target) => createFileSystem(target, this.adapters.paths));
    if (!root) {
      return null;
    }
    return this.applyRoot(root);
  }

  // Applies an already-resolved root at activation, without the setup wizard.
  async loadInitial(root: vscode.Uri): Promise<ActiveServices> {
    return this.applyRoot(root);
  }

  // The single place that builds services for a root and wires everything that follows it:
  // the tree view (via onDidChangeRoot), the external-change watcher, the mirrored setting and the sync controller.
  private async applyRoot(root: vscode.Uri): Promise<ActiveServices> {
    const services = await buildServices(this.context, root, this.eventBus, this.adapters);
    this.root = root;
    this.activeServices = services;
    this.changeEmitter.fire({ root, services });
    this.externalChangeHandling.watch(root);
    void mirrorLibraryRoot(root, services.logger, this.adapters.sharedLibraryConfig);
    await this.syncLifecycle.ensure(root, services);
    return services;
  }
}
