// Registers the commands that open the list and reader panels: the list tab, the PDF viewer,
// annotation export and the reader's own contributed keybindings.
import * as vscode from "vscode";

import { exportAnnotations, type ReaderCommandId } from "@labshelf/core";
import { PdfViewerPanel, createVsCodeExportPorts } from "../../pdf-viewer/index.js";
import { ListWebviewPanel } from "../../ui/list/index.js";
import type { LibraryNode } from "../../ui/library/index.js";
import { resolvePaper, ensurePaperPdf, folderActions, type FolderCommandHost, type ActiveServices, currentTextLayerJobs, onTextLayerJobsChanged } from "../../commands/index.js";
import { findSimilarPapers } from "../../ai/service/index.js";
import type { AiService } from "../../ai/service/index.js";
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
  getAiService: () => AiService | null;
  adapters: HostAdapters;
}

function registerOpenListTabCommand(deps: PanelCommandsDeps): void {
  const { context, events, requireServices, papersRootUri, folderHost, syncTreeToPanel, getAiService, adapters } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", (node?: LibraryNode) => {
      requireServices().then((services) => {
        if (services) {
          ListWebviewPanel.createOrShow(
            {
              extensionUri: context.extensionUri, paperService: services.paperService, events, logger: services.logger, pathOps: adapters.paths,
              getPapersRoot: () => papersRootUri()?.fsPath ?? null,
              getSnapshot: () => services.library.snapshot, folders: folderActions(folderHost),
              onDidNavigate: syncTreeToPanel,
              textLayerJobs: { current: currentTextLayerJobs, onDidChange: onTextLayerJobsChanged },
              loadSidecar: (paperId) => services.paperDataStore.load(paperId),
              findSimilar: (paper) => findSimilarPapers(getAiService(), paper),
            },
            node,
          );
        }
      });
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
      vscode.commands.registerCommand(`labshelf.reader.${id}`, () => { PdfViewerPanel.postToActive(id); }),
    ),
  );
}

export function registerPanelCommands(deps: PanelCommandsDeps): void {
  registerOpenListTabCommand(deps);
  registerReaderPanelCommands(deps);
}
