// Registers the commands that open the list and reader panels: the list tab, the citation map, the PDF viewer,
// annotation export and the reader's own contributed keybindings.
import * as vscode from "vscode";

import { exportAnnotations, findSimilarPapers, type AiService, type ILogger, type ProjectLibraryPort, type ReaderCommandId } from "@labshelf/core";
import { PdfViewerPanel, ReaderPanel, createVsCodeExportPorts } from "../reader/index.js";
import { DetailsView, registerDetailsView, type SelectionSources } from "../libraryUi/details/index.js";
import {
  ListWebviewPanel,
  type ListPanelDeps,
  libraryPaths,
  rootNode,
} from "../libraryUi/index.js";
import { citationMapPorts } from "../libraryUi/citationMap/index.js";
import { PaperFileService } from "../library/index.js";
import type { LibraryNode } from "../libraryUi/index.js";
import { resolvePaper, ensurePaperPdf, folderActions, type FolderCommandHost, type ActiveServices, currentTextLayerJobs, onTextLayerJobsChanged } from "../command/index.js";
import type { LibraryEvents } from "../library/index.js";
import type { HostAdapters } from "./hostAdapters.js";

interface DetailsWiring {
  context: vscode.ExtensionContext;
  details: DetailsView;
  currentServices: () => ActiveServices | null;
  onDidChangeRoot: vscode.Event<unknown>;
  adapters: Pick<HostAdapters, "paths">;
  papersRootUri: () => vscode.Uri | null;
  logger: ILogger;
  /** Builds the list panel dependencies for the open library. */
  listPanelDeps: (services: ActiveServices) => ListPanelDeps;
}

function wireDetailsSources({ context, details, currentServices, onDidChangeRoot, adapters, papersRootUri, listPanelDeps, logger }: DetailsWiring): void {
  context.subscriptions.push(
    details.onDidRequestFolder((ui) => {
      const services = currentServices();
      const root = papersRootUri()?.fsPath;
      if (!services || !root) {
        void logger.log("WARN", "details.folder", "Folder request dropped: no library is open", { folder: ui });
        return;
      }
      const dir = libraryPaths(root, adapters.paths).fromUi(ui);
      const node = dir === root ? rootNode(dir) : { label: adapters.paths.basename(dir), dirPath: dir };
      ListWebviewPanel.createOrShow(listPanelDeps(services), node);
    }),
    onDidChangeRoot(() => { void details.rebindLibrary(); }),
  );
}

const READER_COMMANDS: readonly ReaderCommandId[] = [
  "zoomIn", "zoomOut", "zoomReset", "find", "historyBack", "historyForward", "toggleSidebar",
];

export interface PanelCommandsDeps {
  addToSpace?: (ids: string[]) => Promise<boolean>;
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  requireServices: () => Promise<ActiveServices | null>;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  showFolderInSidebar: (folder?: LibraryNode) => void;
  showPaperInSidebar: (paperId: string) => void;
  getAiService: () => AiService | null;
  /** The writing projects' backlink index, shown in the detail pane as "Cited in". */
  projectBacklinks: NonNullable<ListPanelDeps["projectBacklinks"]>;
  adapters: HostAdapters;
  /** The open library's services, or null while none is open. */
  currentServices: () => ActiveServices | null;
  /** Fires when the library root changes, so the Details view serves the new library. */
  onDidChangeRoot: vscode.Event<unknown>;
  /** The All projects library port, which the Details view serves on its projects channel. */
  projectLibrary: () => ProjectLibraryPort;
  logger: ILogger;
  sources: SelectionSources;
}

function listPanelDeps(deps: PanelCommandsDeps, services: ActiveServices): ListPanelDeps {
  const { context, events, papersRootUri, folderHost, showFolderInSidebar, showPaperInSidebar, getAiService, adapters, projectBacklinks, sources } = deps;
  return {
    extensionUri: context.extensionUri, paperService: services.paperService, events, logger: services.logger, pathOps: adapters.paths,
    getPapersRoot: () => papersRootUri()?.fsPath ?? null,
    getSnapshot: () => services.library.snapshot, folders: folderActions(folderHost),
    citationMap: citationMapPorts(services),
    onDidNavigate: showFolderInSidebar,
    onDidSelectPaper: showPaperInSidebar,
    onDidChangeSelection: sources.listSelected,
    onDidActivate: sources.listActivated,
    textLayerJobs: { current: currentTextLayerJobs, onDidChange: onTextLayerJobsChanged },
    loadSidecar: (paperId) => services.paperDataStore.load(paperId),
    findSimilar: (paper) => findSimilarPapers(getAiService(), paper),
    projectBacklinks, ...(deps.addToSpace ? { addToSpace: deps.addToSpace } : {}),
    paperFiles: new PaperFileService(
      services.fileSystem, (id) => services.paperService.findPaper(id), services.mutations, services.logger, services.reindexLibrary,
    ),
  };
}

function registerOpenListTabCommand(deps: PanelCommandsDeps, details: DetailsView): void {
  const { context, requireServices } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", async (node?: LibraryNode) => {
      const services = await requireServices();
      if (!services) { return; }
      // Details opens with the list tab, but only when the tab opens, so a user who closes it while browsing keeps it closed.
      // Revealing it first lets the new tab take the focus back.
      if (!ListWebviewPanel.currentPanel) { await details.reveal(); }
      ListWebviewPanel.createOrShow(listPanelDeps(deps, services), node);
    }),
    // Run by the Library sidebar's paper rows only, so they have no package.json contribution.
    vscode.commands.registerCommand("labshelf.revealPaper", async (paperId: string) => {
      const services = await requireServices();
      if (services) { await ListWebviewPanel.revealPaper(listPanelDeps(deps, services), paperId); }
    }),
    vscode.commands.registerCommand("labshelf.searchListTag", async (tag: string) => {
      const services = await requireServices();
      if (services) { await ListWebviewPanel.showTag(listPanelDeps(deps, services), tag); }
    }),
    vscode.commands.registerCommand("labshelf.showCitationMap", async () => {
      const services = await requireServices();
      if (services) { ListWebviewPanel.showCitationMap(listPanelDeps(deps, services)); }
    }),
  );
}

function registerReaderPanelCommands(deps: PanelCommandsDeps): void {
  const { context, events, requireServices, adapters } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPdfViewer", async (paperId?: string, page?: number) => {
      const services = await requireServices();
      if (!services) { return; }
      // Without an id (command palette) the user picks the paper.
      const paper = await resolvePaper(services.paperService, paperId, "Open paper in the reader");
      if (!paper) { return; }
      // One guard covers every reader entry point (double-click, Enter, child
      // row, detail button, palette): a PDF-less paper warns and opens nothing.
      if (!(await ensurePaperPdf(services, paper))) { return; }
      PdfViewerPanel.createOrShow(
        {
          extensionUri: context.extensionUri,
          events,
          store: services.paperDataStore,
          logger: services.logger,
          locatePdfjs: adapters.reader.locatePdfjs,
          isMac: adapters.reader.isMac,
        },
        paper,
        typeof page === "number" ? { page } : {},
      );
    }),
    // The list passes "file": it copies the Markdown itself, so only saving is left to ask for.
    vscode.commands.registerCommand("labshelf.exportAnnotations", async (paperId?: string, to?: "file") => {
      const services = await requireServices();
      if (!services) { return; }
      const paper = await resolvePaper(services.paperService, paperId, "Export annotations to Markdown");
      if (!paper) { return; }
      const target = to ?? (await vscode.window.showQuickPick(
        [{ label: "Copy to clipboard", target: "clipboard" as const }, { label: "Save as file...", target: "file" as const }],
        { placeHolder: "Export annotations as Markdown" },
      ))?.target;
      if (target) { await exportAnnotations(createVsCodeExportPorts(paper, services.paperDataStore), target); }
    }),
    // Contributed keybindings (scoped to the focused reader panel) land here: VS Code resolves those chords
    // before the webview sees them, so the reader cannot rely on its own keydown handler alone.
    ...READER_COMMANDS.map((id) =>
      vscode.commands.registerCommand(`labshelf.reader.${id}`, () => { ReaderPanel.postToActive(id); }),
    ),
  );
}

/** @returns the Details view, so callers can show a target in it and route the folders it asks to open */
export function registerPanelCommands(deps: PanelCommandsDeps): DetailsView {
  const details = registerDetailsView(deps.context, {
    extensionUri: deps.context.extensionUri, projectLibrary: deps.projectLibrary, logger: deps.logger,
    listDeps: () => { const services = deps.currentServices(); return services ? listPanelDeps(deps, services) : null; },
  });
  registerOpenListTabCommand(deps, details);
  registerReaderPanelCommands(deps);
  deps.context.subscriptions.push(ReaderPanel.onDidActivatePaper(deps.sources.readerActivated));
  wireDetailsSources({
    context: deps.context, details, currentServices: deps.currentServices, onDidChangeRoot: deps.onDidChangeRoot,
    adapters: deps.adapters, papersRootUri: deps.papersRootUri, listPanelDeps: (services) => listPanelDeps(deps, services), logger: deps.logger,
  });
  return details;
}
