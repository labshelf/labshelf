// Activates the extension on either platform: wires services, commands, the Library sidebar, the list panel and the Writing view.
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

import { createSelectionHub, createLibraryLayout, createRecentTargets, notesText, type AiService, type ILogger } from "@labshelf/core";
import { createNodeCellRunner, createSharedPythonProvider } from "@labshelf/core/node";
import { SEND_TO_RECENT_KEY, createMementoKeyValueStore } from "../reader/index.js";
import { ListWebviewPanel, createSelectionSources, type DetailsView } from "../libraryUi/index.js";
import { registerCommands, registerAiCommands, type FolderCommandHost, type ActiveServices } from "../command/index.js";
import {
  ConflictHandling, createLibraryEvents, moveLibraryRootToConfig, registerConflictCommand, registerSyncGuideCommand, resolveLibraryRoot, type LibraryEvents,
} from "../library/index.js";
import type { ExtensionPlatform } from "./extensionPlatform.js";
import { ExternalChangeHandling } from "./externalChangeHandling.js";
import { LibraryRootController } from "./libraryRootController.js";
import { openLibraryLogger } from "./openLibraryLogger.js";
import { registerLibraryCommands } from "./registerLibraryCommands.js";
import { registerLibrarySidebar } from "./registerLibrarySidebar.js";
import { registerPanelCommands } from "./registerPanelCommands.js";
import { registerSettingsMenu } from "./registerSettingsMenu.js";
import { registerWritingView } from "./registerWritingView.js";
import { registerProjectNoteCommands } from "../writing/projects/index.js";
import { registerNoteLens } from "../writing/citations/index.js";
import { registerNoteLinks } from "../writing/index.js";
import { registerSpaces, addToSpace } from "../spaces/index.js";
import { startAiService } from "./startAiService.js";
import { createInstallPython, createRunCellPort } from "../qmd/runCell.js";

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
  registerProjectNoteCommands({ context, projects: writing.projects, store: writing.notes, logger: writing.logger });
  registerNoteLensOf(context, controller, writing);
  registerNoteLinks(context, {
    projects: writing.projects, notes: writing.notes, logger: writing.logger,
    library: () => {
      const services = controller.currentServices();
      return services ? {
        listPapers: () => services.paperService.listPapers(),
        readNotesText: async (paperId) => notesText(await services.paperNotesStore.read(paperId)),
      } : undefined;
    },
  });
  // One runner and one Python per activation, shared by the list panel, the reader and Spaces.
  const cells = createCellHosts(context, writing.logger);
  const spaces = registerSpaces(context, controller, adapters, writing, async id => {
    await vscode.commands.executeCommand("labshelf.revealPaper", id);
    sources.listSelected([id]);
    sources.listActivated();
  }, cells);
  const { librarySidebar, showFolderInSidebar, showPaperInSidebar, refreshLibraryViews: refreshViews } = registerLibrarySidebar({
    context, events, controller, papersRootUri, folderHost, adapters, projects: writing.projectsSource, projectTrees: writing.projectTrees, spaces,
  });
  refreshLibraryViews = refreshViews;

  registerSettingsMenu(context, controller);

  details = registerPanelCommands({
    ...cells,
    context, events, requireServices, papersRootUri, folderHost, showFolderInSidebar, showPaperInSidebar, adapters,
    getAiService: () => aiService, projectBacklinks: writing.backlinks, addToSpace: ids => addToSpace(spaces, ids),
    currentServices: () => controller.currentServices(), onDidChangeRoot: controller.onDidChangeRoot, projectLibrary: writing.projectLibrary, logger: writing.logger, sources,
    sendTo: sendToDeps(context, writing),
  });

  registerLibraryCommands({ context, controller, folderHost, librarySidebar });
  registerSyncGuideCommand(context, () => controller.currentServices()?.logger);
  platform.registerPlatformCommands?.(context, controller, writing.projects);

  registerCommands(context, requireServices);
  registerAiCommands(context, () => aiService);

  logPaperEvents(events, controller.currentServices());
}

/** The shared Python and the cell runner built once, as the ports the note hosts run cells and install Python through. */
function createCellHosts(context: vscode.ExtensionContext, logger: ILogger) {
  const python = createSharedPythonProvider({ env: process.env, platform: process.platform, homeDir: os.homedir(), logger, fetchImpl: fetch });
  // The bundle copies the driver beside extension.js.
  const runner = createNodeCellRunner({ python, logger, driverPath: path.join(context.extensionPath, "out", "cellDriver.py") });
  return { runCell: createRunCellPort(runner), installPython: createInstallPython(python, logger) };
}

/** Registers the note lens over the open project, reading the paper library through the active services. */
function registerNoteLensOf(context: vscode.ExtensionContext, controller: LibraryRootController, writing: ReturnType<typeof registerWritingView>): void {
  registerNoteLens({
    context, projects: writing.projects, backlinks: writing.backlinks,
    library: () => {
      const root = controller.currentRoot();
      const services = controller.currentServices();
      return root && services ? {
        root: root.fsPath, logger: services.logger,
        listPapers: () => services.paperService.listPapers(), readNotes: (paperId) => services.paperNotesStore.read(paperId),
      } : undefined;
    },
  });
}

function sendToDeps(context: vscode.ExtensionContext, writing: ReturnType<typeof registerWritingView>) {
  return {
    projects: writing.projects, notes: writing.notes, logger: writing.logger,
    recent: createRecentTargets(createMementoKeyValueStore(context.globalState), SEND_TO_RECENT_KEY),
    newItemId: () => globalThis.crypto.randomUUID(),
  };
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
  const unmigratedRoot = await moveLibraryRootToConfig(context.globalState, adapters.sharedLibraryConfig, (root) =>
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
