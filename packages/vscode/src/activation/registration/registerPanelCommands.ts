// Registers the commands that open the list and reader panels: the list tab, the citation map, the PDF viewer,
// annotation export and the reader's own contributed keybindings.
import * as vscode from "vscode";

import { exportAnnotations, findSimilarPapers, type AiService, type ReaderCommandId } from "@labshelf/core";
import { PdfViewerPanel, ReaderPanel, createVsCodeExportPorts } from "../../pdf-viewer/index.js";
import { ListWebviewPanel, type ListPanelDeps } from "../../ui/list/index.js";
import { citationMapPorts } from "../../citationMap/index.js";
import { PaperFileService } from "../../core/index.js";
import type { LibraryNode } from "../../ui/library/index.js";
import { resolvePaper, ensurePaperPdf, folderActions, type FolderCommandHost, type ActiveServices, currentTextLayerJobs, onTextLayerJobsChanged } from "../../commands/index.js";
import type { LibraryEvents } from "../../events/index.js";
import type { HostAdapters } from "../serviceComposition/index.js";

const READER_COMMANDS: readonly ReaderCommandId[] = [
  "zoomIn", "zoomOut", "zoomReset", "find", "historyBack", "historyForward", "toggleSidebar",
];

export interface PanelCommandsDeps {
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  requireServices: () => Promise<ActiveServices | null>;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  syncTreeToPanel: (folder?: LibraryNode) => void;
  revealPaperInTree: (paperId: string) => void;
  getAiService: () => AiService | null;
  /** The writing projects' backlink index, shown in the detail pane as "Cited in". */
  projectBacklinks: NonNullable<ListPanelDeps["projectBacklinks"]>;
  adapters: HostAdapters;
}

function listPanelDeps(deps: PanelCommandsDeps, services: ActiveServices): ListPanelDeps {
  const { context, events, papersRootUri, folderHost, syncTreeToPanel, revealPaperInTree, getAiService, adapters, projectBacklinks } = deps;
  return {
    extensionUri: context.extensionUri, paperService: services.paperService, events, logger: services.logger, pathOps: adapters.paths,
    getPapersRoot: () => papersRootUri()?.fsPath ?? null,
    getSnapshot: () => services.library.snapshot, folders: folderActions(folderHost),
    citationMap: citationMapPorts(services),
    onDidNavigate: syncTreeToPanel,
    onDidSelectPaper: revealPaperInTree,
    textLayerJobs: { current: currentTextLayerJobs, onDidChange: onTextLayerJobsChanged },
    loadSidecar: (paperId) => services.paperDataStore.load(paperId),
    findSimilar: (paper) => findSimilarPapers(getAiService(), paper),
    projectBacklinks,
    paperFiles: new PaperFileService(
      services.fileSystem, (id) => services.paperService.findPaper(id), services.mutations, services.logger, services.reindexLibrary,
    ),
  };
}

function registerOpenListTabCommand(deps: PanelCommandsDeps): void {
  const { context, requireServices } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", (node?: LibraryNode) => {
      requireServices().then((services) => {
        if (services) { ListWebviewPanel.createOrShow(listPanelDeps(deps, services), node); }
      });
    }),
    // Run by the Library tree's paper and scope rows only, so they have no package.json contribution.
    vscode.commands.registerCommand("labshelf.revealPaper", async (paperId: string) => {
      const services = await requireServices();
      if (services) { await ListWebviewPanel.revealPaper(listPanelDeps(deps, services), paperId); }
    }),
    vscode.commands.registerCommand("labshelf.openListScope", async () => {
      const services = await requireServices();
      if (services) { ListWebviewPanel.createOrShow(listPanelDeps(deps, services)); }
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

export function registerPanelCommands(deps: PanelCommandsDeps): void {
  registerOpenListTabCommand(deps);
  registerReaderPanelCommands(deps);
}
