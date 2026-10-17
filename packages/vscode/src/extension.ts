/** Activates the extension: wires services, commands, Library sidebar and list panel. */
import * as vscode from "vscode";

import { libraryLayout, type AiService } from "@labshelf/core";
import { resolveLibraryRoot } from "./storage/paths/index.js";
import { migrateLibraryRootFromGlobalState } from "./storage/migrations/index.js";
import { createNodeAdapters } from "./activation/node/index.js";
import { ListWebviewPanel } from "./ui/list/index.js";
import {
  registerCommands,
  registerAiCommands,
  type FolderCommandHost,
  type ActiveServices,
} from "./commands/index.js";
import { createLibraryEvents, type LibraryEvents } from "./events/index.js";
import {
  startAiService,
  LibraryRootController,
  ExternalChangeHandling,
  registerLibrarySidebar,
  registerLibraryCommands,
  registerSettingsMenu,
  registerPanelCommands,
  registerWritingView,
} from "./activation/index.js";
import { registerNodeWriting } from "./writing/node/index.js";

/** Activates the extension, initializing services if a library is already configured */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const events = createLibraryEvents();
  context.subscriptions.push(...Object.values(events));
  const adapters = createNodeAdapters(context);

  // Reassigned once the Library sidebar is registered; the lifecycle modules below only ever
  // call it after that point, so the forward reference is safe.
  let refreshLibraryViews: () => void = () => {};

  const controller = createLibraryController({
    context, events, adapters, refreshViews: () => refreshLibraryViews(),
  });

  const papersRootUri = papersRootResolver(controller);
  const aiService = await loadConfiguredLibrary(context, events, controller, adapters);

  // Returns current services or triggers the setup wizard and builds services from the chosen root.
  const requireServices = (): Promise<ActiveServices | null> => controller.require();

  const folderHost: FolderCommandHost = {
    requireServices,
    papersRoot: () => papersRootUri()?.fsPath ?? null,
    refreshViews: () => refreshLibraryViews(),
    followFolderMove: async (from, to) => { await ListWebviewPanel.currentPanel?.followFolderMove(from, to); },
  };

  const writing = registerWritingView(context, controller, adapters.reader, adapters, registerNodeWriting);
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

interface LibraryControllerDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  adapters: ReturnType<typeof createNodeAdapters>;
  refreshViews: () => void;
}

function createLibraryController(deps: LibraryControllerDeps): LibraryRootController {
  const { context, events, adapters, refreshViews } = deps;
  const externalChangeHandling = new ExternalChangeHandling({
    context,
    getActiveServices: () => controller.currentServices(),
    onRefresh: refreshViews,
  });
  const controller = new LibraryRootController(context, events, externalChangeHandling, adapters);
  return controller;
}

/** Opens the configured library, or tells the user to configure one. @returns the AI service, when one started. */
async function loadConfiguredLibrary(
  context: vscode.ExtensionContext,
  events: LibraryEvents,
  controller: LibraryRootController,
  adapters: ReturnType<typeof createNodeAdapters>,
): Promise<AiService | null> {
  const unmigratedRoot = await migrateLibraryRootFromGlobalState(context.globalState, adapters.sharedLibraryConfig, (root) =>
    adapters.createLogger(libraryLayout(vscode.Uri.file(root), vscode.Uri.joinPath).appLogPath().fsPath));
  const initialRoot = await resolveLibraryRoot(adapters.sharedLibraryConfig)
    ?? (unmigratedRoot ? vscode.Uri.file(unmigratedRoot) : undefined);
  if (!initialRoot) {
    // Library not configured — inform the user without blocking activation.
    vscode.window.showInformationMessage(
      'LabShelf: No library configured. Run "Configure Library" to get started.',
      "Configure Library",
    ).then((choice) => {
      if (choice === "Configure Library") {
        vscode.commands.executeCommand("labshelf.configureLibrary");
      }
    });
    return null;
  }

  // The progress bar on the Library view covers the time the index takes to open.
  let aiService: AiService | null = null;
  await vscode.window.withProgress({ location: { viewId: "labshelf.library" } }, async () => {
    const services = await controller.loadInitial(initialRoot);
    aiService = await startAiService(context, events, services, adapters);
    return services;
  });
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

/** Called by VS Code on extension deactivation — cleanup is handled via disposables */
export function deactivate(): void { return; }
