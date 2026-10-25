// Activates the extension on either platform: wires services, commands, the Library sidebar, the list panel and the Writing view.
import * as vscode from "vscode";

import { createSelectionHub, createLibraryLayout, type AiService } from "@labshelf/core";
import { resolveLibraryRoot } from "../storage/paths/index.js";
import { migrateLibraryRootFromGlobalState } from "../storage/index.js";
import { createSelectionSources, type DetailsView } from "../libraryUi/details/index.js";
import { ListWebviewPanel } from "../libraryUi/index.js";
import { registerCommands, registerAiCommands, type FolderCommandHost, type ActiveServices } from "../command/index.js";
import { createLibraryEvents, type LibraryEvents } from "../library/index.js";
import { ConflictHandling, registerConflictCommand, registerSyncGuideCommand } from "../library/index.js";
import type { ExtensionPlatform } from "./extensionPlatform.js";
import { ExternalChangeHandling } from "./externalChangeHandling.js";
import { LibraryRootController } from "./libraryRootController.js";
import { openLibraryLogger } from "./openLibraryLogger.js";
import { registerLibraryCommands } from "./registerLibraryCommands.js";
import { registerLibrarySidebar } from "./registerLibrarySidebar.js";
import { registerPanelCommands } from "./registerPanelCommands.js";
import { registerSettingsMenu } from "./registerSettingsMenu.js";
import { registerWritingView } from "./registerWritingView.js";
import { registerSpaces, addToSpace } from "../spaces/index.js";
import { startAiService } from "./startAiService.js";

export async function startExtension(context: vscode.ExtensionContext, platform: ExtensionPlatform): Promise<void> {
  const { adapters } = platform;
  const events = createLibraryEvents();
  context.subscriptions.push(...Object.values(events));

  // Reassigned once the Library sidebar is registered; the lifecycle modules below only ever
  // call it after that point, so the forward reference is safe.
  let refreshLibraryViews: () => void = () => {};

  const controller = createLibraryController(context, events, platform, () => refreshLibraryViews());
  const papersRootUri = papersRootResolver(controller);
  const aiService = await loadConfiguredLibrary(context, events, controller, platform);

  const requireServices = (): Promise<ActiveServices | null> => controller.require();

  const folderHost = createFolderHost(requireServices, papersRootUri, () => refreshLibraryViews());

  let details: DetailsView | undefined;
  const sources = createSelectionSources(createSelectionHub((target) => details?.show(target)), openLibraryLogger(controller));
  const writing = registerWritingView(context, controller, adapters, platform.registerWriting, sources);
  const spaces = registerSpaces(context, controller, adapters, writing, async id => {
    await vscode.commands.executeCommand("labshelf.revealPaper", id);
    sources.listSelected([id]);
    sources.listActivated();
  });
  const { librarySidebar, showFolderInSidebar, showPaperInSidebar, refreshLibraryViews: refreshViews } = registerLibrarySidebar({
    context, events, controller, papersRootUri, folderHost, adapters, projects: writing.projectsSource, projectTrees: writing.projectTrees, spaces,
  });
  refreshLibraryViews = refreshViews;

  registerSettingsMenu(context, controller);

  details = registerPanelCommands({
    context, events, requireServices, papersRootUri, folderHost, showFolderInSidebar, showPaperInSidebar, adapters,
    getAiService: () => aiService, projectBacklinks: writing.backlinks, addToSpace: ids => addToSpace(spaces, ids),
    currentServices: () => controller.currentServices(), onDidChangeRoot: controller.onDidChangeRoot, projectLibrary: writing.projectLibrary, logger: writing.logger, sources,
  });

  registerLibraryCommands({ context, controller, folderHost, librarySidebar });
  registerSyncGuideCommand(context, () => controller.currentServices()?.logger);
  platform.registerPlatformCommands?.(context, controller, writing.projects);

  registerCommands(context, requireServices);
  registerAiCommands(context, () => aiService);

  logPaperEvents(events, controller.currentServices());
}

function createFolderHost(
  requireServices: () => Promise<ActiveServices | null>, papersRoot: () => vscode.Uri | null, refreshViews: () => void,
): FolderCommandHost {
  return {
    requireServices, papersRoot: () => papersRoot()?.fsPath ?? null, refreshViews,
    followFolderMove: async (from, to) => { await ListWebviewPanel.currentPanel?.followFolderMove(from, to); },
  };
}

function papersRootResolver(controller: LibraryRootController): () => vscode.Uri | null {
  return () => {
    const root = controller.currentRoot();
    return root ? createLibraryLayout(root, vscode.Uri.joinPath).papersRoot() : null;
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
    resolveCopy: (copy, resolution, logger) => {
      const root = controller.currentRoot();
      if (!root) throw new Error("Open a library before resolving a conflict");
      return adapters.resolveConflictCopy(copy, resolution, logger, root.fsPath);
    },
    paths: adapters.paths,
  });
  registerConflictCommand(context, conflicts);
  const externalChangeHandling: ExternalChangeHandling = new ExternalChangeHandling({
    context,
    getActiveServices: () => controller.currentServices(),
    onRefresh: refreshViews,
    onConflicts: (copies) => conflicts.onConflicts(copies),
    scanConflicts: adapters.scanLibraryConflicts,
  });
  const controller: LibraryRootController = new LibraryRootController(context, events, externalChangeHandling, adapters, () => platform.chooseLibraryRoot());
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
