/** Extension entry point — wires services, commands, library folder tree, sync controller, and list panel on activation */
import * as vscode from "vscode";

import { libraryChanged, libraryLayout } from "@labshelf/core";
import { resolveLibraryRoot } from "./storage/paths/index.js";
import { createNodeAdapters } from "./activation/node/index.js";
import { ListWebviewPanel } from "./ui/list/index.js";
import {
  registerCommands,
  registerAiCommands,
  type FolderCommandHost,
  type ActiveServices,
} from "./commands/index.js";
import { AiService } from "./ai/service/index.js";
import { EventBus } from "./events/index.js";
import {
  startAiService,
  LibraryRootController,
  SyncControllerLifecycle,
  ExternalChangeHandling,
  registerLibraryTreeView,
  registerLibraryCommands,
  registerSettingsView,
  registerPanelCommands,
  registerSyncCommands,
} from "./activation/index.js";

/** Activates the extension, initializing services if a library is already configured */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const eventBus = new EventBus();
  const adapters = createNodeAdapters(context);

  // The settings page hears sync status through this, including from a controller created after the page opened.
  const driveStatusChanged = new vscode.EventEmitter<void>();
  context.subscriptions.push(driveStatusChanged);
  let aiService: AiService | null = null;

  // Reassigned once the Library tree view is registered; the lifecycle modules below only ever
  // call it after that point, so the forward reference is safe.
  let refreshLibraryViews: () => void = () => {};

  const externalChangeHandling = new ExternalChangeHandling({
    context,
    getActiveServices: () => controller.currentServices(),
    onRefresh: () => refreshLibraryViews(),
  });
  const syncLifecycle = new SyncControllerLifecycle({
    context,
    eventBus,
    adapters,
    driveStatusChanged,
    getActiveServices: () => controller.currentServices(),
    // A sync that pulls files from Drive must surface in the list without a reload.
    onSynced: async (result) => {
      if (!libraryChanged(result)) { return; }
      await externalChangeHandling.reindexAndRefresh("sync");
    },
  });
  const controller = new LibraryRootController(context, eventBus, externalChangeHandling, syncLifecycle, adapters);

  const papersRootUri = (): vscode.Uri | null => {
    const root = controller.currentRoot();
    return root ? libraryLayout(root, vscode.Uri.joinPath).papersRoot() : null;
  };

  const initialRoot = await resolveLibraryRoot(context, adapters.sharedLibraryConfig);
  if (initialRoot) {
    // The Library tree is only registered once the index is open. Until then the view shows
    // "Loading your library…" (package.json viewsWelcome, keyed on labshelf.libraryLoaded) under
    // VS Code's own progress bar, never "No folders yet", which would read as a lost library.
    await vscode.window.withProgress({ location: { viewId: "labshelf.library" } }, async () => {
      const services = await controller.loadInitial(initialRoot);
      aiService = await startAiService(context, eventBus, services, adapters);
      return services;
    });
  } else {
    // Library not configured — inform the user without blocking activation.
    vscode.window.showInformationMessage(
      'LabShelf: No library configured. Run "Configure Library" to get started.',
      "Configure Library",
    ).then((choice) => {
      if (choice === "Configure Library") {
        vscode.commands.executeCommand("labshelf.configureLibrary");
      }
    });
  }

  // Returns current services or triggers the setup wizard and builds services from the chosen root.
  const requireServices = (): Promise<ActiveServices | null> => controller.require();

  const folderHost: FolderCommandHost = {
    requireServices,
    papersRoot: () => papersRootUri()?.fsPath ?? null,
    refreshViews: () => refreshLibraryViews(),
    followFolderMove: async (from, to) => { await ListWebviewPanel.currentPanel?.followFolderMove(from, to); },
  };

  const { libraryProvider, syncTreeToPanel, refreshLibraryViews: refreshViews } = registerLibraryTreeView({
    context, eventBus, controller, papersRootUri, folderHost, adapters,
  });
  refreshLibraryViews = refreshViews;

  registerSettingsView({ context, controller, driveStatusChanged });

  registerPanelCommands({
    context, eventBus, requireServices, papersRootUri, folderHost, syncTreeToPanel, adapters,
    getAiService: () => aiService,
  });

  registerLibraryCommands({ context, controller, folderHost, libraryProvider });

  registerSyncCommands({ context, controller, requireServices });

  registerCommands(context, requireServices);
  registerAiCommands(context, () => aiService);

  const activeServices = controller.currentServices();
  if (activeServices) {
    const services = activeServices;
    eventBus.on("paper:added", async (payload) => {
      await services.logger.log("INFO", "extension", "Paper added", { payload });
    });
    eventBus.on("paper:updated", async (payload) => {
      await services.logger.log("INFO", "extension", "Paper updated", { payload });
    });
  }
}

/** Called by VS Code on extension deactivation — cleanup is handled via disposables */
export function deactivate(): void { return; }
