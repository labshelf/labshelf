// Activates the extension on either platform: wires services, commands, the Library sidebar, the list panel and the Writing view.
import * as vscode from "vscode";

import { libraryLayout, type AiService } from "@labshelf/core";
import { resolveLibraryRoot } from "../storage/paths/index.js";
import { migrateLibraryRootFromGlobalState } from "../storage/migrations/index.js";
import { ListWebviewPanel } from "../ui/list/index.js";
import { registerCommands, registerAiCommands, type FolderCommandHost, type ActiveServices } from "../commands/index.js";
import { createLibraryEvents, type LibraryEvents } from "../events/index.js";
import { ConflictHandling, registerConflictCommand, registerSyncGuideCommand } from "../library/index.js";
import type { ExtensionPlatform } from "./extensionPlatform.js";
import { ExternalChangeHandling, LibraryRootController } from "./libraryLifecycle/index.js";
import {
  registerLibraryCommands, registerLibrarySidebar, registerPanelCommands, registerSettingsMenu, registerWritingView,
} from "./registration/index.js";
import { startAiService } from "./serviceComposition/index.js";

export async function activateExtension(context: vscode.ExtensionContext, platform: ExtensionPlatform): Promise<void> {
  const { adapters } = platform;
  const events = createLibraryEvents();
  context.subscriptions.push(...Object.values(events));

  // Reassigned once the Library sidebar is registered; the lifecycle modules below only ever
  // call it after that point, so the forward reference is safe.
  let refreshLibraryViews: () => void = () => {};

  const controller = createLibraryController(context, events, platform, () => refreshLibraryViews());
  const papersRootUri = papersRootResolver(controller);
  const aiService = await loadConfiguredLibrary(context, events, controller, platform);

  // Returns current services or triggers the setup wizard and builds services from the chosen root.
  const requireServices = (): Promise<ActiveServices | null> => controller.require();

  const folderHost: FolderCommandHost = {
    requireServices,
    papersRoot: () => papersRootUri()?.fsPath ?? null,
    refreshViews: () => refreshLibraryViews(),
    followFolderMove: async (from, to) => { await ListWebviewPanel.currentPanel?.followFolderMove(from, to); },
  };

  const writing = registerWritingView(context, controller, adapters, platform.registerWriting);
  const { librarySidebar, showFolderInSidebar, showPaperInSidebar, refreshLibraryViews: refreshViews } = registerLibrarySidebar({
    context, events, controller, papersRootUri, folderHost, adapters, projects: writing.projectsSource, projectTrees: writing.projectTrees,
  });
  refreshLibraryViews = refreshViews;

  registerSettingsMenu(context, controller);

  registerPanelCommands({
    context, events, requireServices, papersRootUri, folderHost, showFolderInSidebar, showPaperInSidebar, adapters,
    getAiService: () => aiService, projectBacklinks: writing.backlinks,
  });

  registerLibraryCommands({ context, controller, folderHost, librarySidebar });
  registerSyncGuideCommand(context, () => controller.currentServices()?.logger);
  platform.registerPlatformCommands?.(context, controller);

  registerCommands(context, requireServices);
  registerAiCommands(context, () => aiService);

  logPaperEvents(events, controller.currentServices());
}

function papersRootResolver(controller: LibraryRootController): () => vscode.Uri | null {
  return () => {
    const root = controller.currentRoot();
    return root ? libraryLayout(root, vscode.Uri.joinPath).papersRoot() : null;
  };
}

function createLibraryController(
  context: vscode.ExtensionContext, events: LibraryEvents, platform: ExtensionPlatform, refreshViews: () => void,
): LibraryRootController {
  const { adapters } = platform;
  const conflicts = new ConflictHandling({
    getServices: () => controller.currentServices(),
    getRoot: () => controller.currentRoot()?.fsPath ?? null,
    scanConflicts: adapters.scanLibraryConflicts,
    resolveCopy: adapters.resolveConflictCopy,
    paths: adapters.paths,
  });
  registerConflictCommand(context, conflicts);
  const externalChangeHandling = new ExternalChangeHandling({
    context,
    getActiveServices: () => controller.currentServices(),
    onRefresh: refreshViews,
    onConflicts: (copies) => conflicts.onConflicts(copies),
    scanConflicts: adapters.scanLibraryConflicts,
  });
  const controller = new LibraryRootController(context, events, externalChangeHandling, adapters, () => platform.chooseLibraryRoot());
  return controller;
}

/** Opens the configured library, or asks where a new one lives. @returns the AI service, when one started. */
async function loadConfiguredLibrary(
  context: vscode.ExtensionContext,
  events: LibraryEvents,
  controller: LibraryRootController,
  platform: ExtensionPlatform,
): Promise<AiService | null> {
  const { adapters } = platform;
  const unmigratedRoot = await migrateLibraryRootFromGlobalState(context.globalState, adapters.sharedLibraryConfig, (root) =>
    adapters.createLogger(adapters.deviceLayout(root).appLogPath));
  const savedRoot = await resolveLibraryRoot(adapters.sharedLibraryConfig)
    ?? (unmigratedRoot ? vscode.Uri.file(unmigratedRoot) : undefined);
  const initialRoot = savedRoot ?? await platform.chooseLibraryRoot();
  if (!initialRoot) { return null; }

  // The progress bar on the Library view covers the time the index takes to open.
  let aiService: AiService | null = null;
  await vscode.window.withProgress({ location: { viewId: "labshelf.library" } }, async () => {
    const services = await controller.applyRoot(initialRoot);
    aiService = await startAiService(context, events, services, adapters);
    return services;
  });
  // A root chosen a moment ago already answered where the library lives, so only a saved root is offered a move.
  if (savedRoot && platform.afterSavedLibraryOpened) {
    platform.afterSavedLibraryOpened(controller).catch((error: unknown) => {
      void controller.currentServices()?.logger.error("libraryMove", error, { action: "offer library move" });
    });
  }
  return aiService;
}

function logPaperEvents(events: LibraryEvents, services: ActiveServices | null): void {
  if (!services) { return; }
  events.paperAdded.event(async (payload) => {
    await services.logger.log("INFO", "extension", "Paper added", { payload });
  });
  events.paperUpdated.event(async (payload) => {
    await services.logger.log("INFO", "extension", "Paper updated", { payload });
  });
}
