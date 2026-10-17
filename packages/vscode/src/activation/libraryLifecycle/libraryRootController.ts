// Owns the active library root and its built services, rebuilding both through one path whether the root
// comes from the first-run question, a move or a saved setting.
import * as vscode from "vscode";

import { buildServices, type HostAdapters } from "../serviceComposition/index.js";
import type { ActiveServices } from "../../commands/index.js";
import type { LibraryEvents } from "../../events/index.js";
import { ExternalChangeHandling } from "./externalChangeHandling.js";

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
    private readonly events: LibraryEvents,
    private readonly externalChangeHandling: ExternalChangeHandling,
    private readonly adapters: HostAdapters,
    private readonly chooseRoot: () => Promise<vscode.Uri | undefined>,
  ) {
    context.subscriptions.push(this.changeEmitter);
  }

  currentRoot(): vscode.Uri | undefined {
    return this.root;
  }

  currentServices(): ActiveServices | null {
    return this.activeServices;
  }

  // Returns the current services or asks where the library lives and builds services from the answer.
  async require(): Promise<ActiveServices | null> {
    return this.activeServices ?? this.reconfigure();
  }

  // Always asks where the library lives, even when a library is already configured.
  async reconfigure(): Promise<ActiveServices | null> {
    const root = await this.chooseRoot();
    return root ? this.applyRoot(root) : null;
  }

  // The single place that builds services for a root and wires everything that follows it:
  // the Library sidebar (via onDidChangeRoot), the external-change watcher.
  async applyRoot(root: vscode.Uri): Promise<ActiveServices> {
    const services = await buildServices(this.context, root, this.events, this.adapters);
    this.root = root;
    this.activeServices = services;
    this.changeEmitter.fire({ root, services });
    this.externalChangeHandling.watch(root);
    return services;
  }
}
