// Registers the commands that open the list and reader panels: the list tab, the citation map, the PDF viewer,
// annotation export and the reader's own contributed keybindings.
import * as vscode from "vscode";

import { PaperFileService, exportAnnotations, findSimilarPapers, type AiService, type EquationPort, type ILogger, type LibraryUiHost, type PaperObjectsPort, type ReaderCommandId, type RunCellPort } from "@labshelf/core";
import { PdfReaderPanel, ReaderPanel, createVsCodeExportPorts, createVsCodeNoteFileIo, type ReaderCite } from "../reader/index.js";
import {
  ListWebviewPanel,
  createCitationMapPorts,
  type LibraryNode,
  type ListPanelDeps,
} from "../libraryUi/index.js";
import { currentSourceFileComments, currentSourceFileSuggestions } from "../collab/index.js";
import type { LibraryEvents } from "../library/index.js";
import { resolvePaper, ensurePaperPdf, createFolderActions, type FolderCommandHost, type ActiveServices, listTextLayerJobs, onTextLayerJobsChanged } from "../command/index.js";
import type { ActiveSource } from "../writing/index.js";
import type { WritingProjects } from "../writing/projects/index.js";
import { registerSourceEditor, type EditorPrefsHost } from "../writing/sourceEditor/index.js";
import type { SourceEditorProviderDeps } from "../writing/sourceEditor/index.js";
import { createAutosave, type DiskMerge } from "../localSync/index.js";
import { createConsultFiles, createVscodeConsultIo } from "../consult/index.js";
import { sourceAuthorities } from "../writing/sourceEditor/authorities.js";
import type { HostAdapters } from "./hostAdapters.js";

const READER_COMMANDS: readonly ReaderCommandId[] = [
  "zoomIn", "zoomOut", "zoomReset", "find", "historyBack", "historyForward", "toggleSidebar",
];

export interface PanelCommandsDeps {
  /** The editors' preferences, shared with the notes editor. */
  editorPrefs: EditorPrefsHost;
  /** Merges disk changes into the dirty documents of the LabShelf source editor. */
  diskMerge?: DiskMerge;
  addToSpace?: (ids: string[]) => Promise<boolean>;
  context: vscode.ExtensionContext;
  events: LibraryEvents;
  requireServices: () => Promise<ActiveServices | null>;
  papersRootUri: () => vscode.Uri | null;
  folderHost: FolderCommandHost;
  showFolderInSidebar: (folder?: LibraryNode) => void;
  getAiService: () => AiService | null;
  /** The writing projects' backlink index, shown in the detail pane as "Cited in". */
  projectBacklinks: NonNullable<ListPanelDeps["projectBacklinks"]>;
  adapters: HostAdapters;
  /** The open library's services, or null while none is open. */
  currentServices: () => ActiveServices | null;
  /** The open library's root folder, whose editor-prefs.json the source editor watches. */
  libraryRoot: () => vscode.Uri | undefined;
  logger: ILogger;
  /** The reader's cite popup. */
  cite?: ReaderCite;
  /** Runs a note's code cell and installs the Python it needs; the list panel and the reader show Run only when present. */
  runCell?: RunCellPort;
  /** Stops a note's process of one language. */
  restartCell?: NonNullable<LibraryUiHost["restartCell"]>;
  installPython?: () => void;
  /** Builds the reader's equation port over the open library's services; absent where the reader cannot extract equations. */
  createEquationPort?: (services: ActiveServices) => EquationPort | undefined;
  /** The notes' From paper… port over the open library; absent on the web. */
  paperObjects?: PaperObjectsPort;
  /** The writing projects, whose files the LabShelf editor for .tex and .typ reads. */
  projects: Pick<WritingProjects, "list" | "paths" | "data" | "fs">;
  /** The extension's one ActiveSource, which every LabShelf editor panel registers with. */
  activeSource: ActiveSource;
  /** What the LabShelf editor reads besides the library's papers: the paper notes store, the note insert source of a project and how to show a paper's notes. */
  sourceEditor: Pick<SourceEditorProviderDeps, "paperNotes" | "noteSource" | "openNotes" | "dictionaries" | "outputSources">;
}

function listPanelDeps(deps: PanelCommandsDeps, services: ActiveServices): ListPanelDeps {
  const { context, events, papersRootUri, folderHost, showFolderInSidebar, getAiService, adapters, projectBacklinks } = deps;
  return {
    extensionUri: context.extensionUri, paperService: services.paperService, events, logger: services.logger, pathOps: adapters.paths,
    getPapersRoot: () => papersRootUri()?.fsPath ?? null,
    getSnapshot: () => services.library.snapshot, folders: createFolderActions(folderHost),
    citationMap: createCitationMapPorts(services),
    onDidNavigate: showFolderInSidebar,
    textLayerJobs: { current: listTextLayerJobs, onDidChange: onTextLayerJobsChanged },
    loadSidecar: (paperId) => services.paperDataStore.load(paperId),
    paperNotes: services.paperNotesStore,
    noteFileIo: createVsCodeNoteFileIo(services.fileSystem, adapters.paths.join),
    findSimilar: (paper) => findSimilarPapers(getAiService(), paper),
    projectBacklinks, ...(deps.addToSpace ? { addToSpace: deps.addToSpace } : {}),
    ...(deps.runCell ? { runCell: deps.runCell } : {}), ...(deps.restartCell ? { restartCell: deps.restartCell } : {}),
    ...(deps.installPython ? { installPython: deps.installPython } : {}),
    paperFiles: new PaperFileService(
      services.fileSystem, (id) => services.paperService.findPaper(id), services.mutations, services.logger, services.reindexLibrary,
    ),
  };
}

function registerOpenListTabCommand(deps: PanelCommandsDeps): void {
  const { context, requireServices } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openListTab", async (node?: LibraryNode) => {
      const services = await requireServices();
      if (!services) { return; }
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

function extractEquationOf(deps: PanelCommandsDeps, services: ActiveServices): { extractEquation?: EquationPort } {
  const port = deps.createEquationPort?.(services);
  return port ? { extractEquation: port } : {};
}

/** The reader panel's dependencies over the open library's services. */
function readerPanelDeps(deps: PanelCommandsDeps, services: ActiveServices): Parameters<typeof PdfReaderPanel.createOrShow>[0] {
  return {
    extensionUri: deps.context.extensionUri,
    events: deps.events,
    store: services.paperDataStore,
    notes: services.paperNotesStore,
    noteFileIo: createVsCodeNoteFileIo(services.fileSystem, deps.adapters.paths.join),
    themes: services.readerThemeStore,
    logger: services.logger,
    locatePdfjs: deps.adapters.reader.locatePdfjs,
    isMac: deps.adapters.reader.isMac,
    ...(deps.cite ? { cite: deps.cite } : {}),
    ...(deps.runCell ? { runCell: deps.runCell } : {}), ...(deps.restartCell ? { restartCell: deps.restartCell } : {}),
    ...(deps.installPython ? { installPython: deps.installPython } : {}), ...extractEquationOf(deps, services),
    ...(deps.paperObjects ? { paperObjects: deps.paperObjects } : {}),
    consult: (post) => readerConsultOf(deps, services, post),
  };
}

/** One reader panel's consult: the open library's papers and the writing projects answer it, its files are clients of the shared authorities. The reader has no project, so no code is listed and Browse… is not offered. */
function readerConsultOf(deps: PanelCommandsDeps, services: ActiveServices, post: Parameters<typeof createConsultFiles>[0]["post"]): ReturnType<typeof createConsultFiles> {
  const library = { listPapers: () => services.paperService.listPapers() };
  const io = createVscodeConsultIo({
    library, projects: deps.projects, highlightsOf: (paperId) => services.paperDataStore.getAnnotations(paperId), paperNotes: deps.sourceEditor.paperNotes,
  });
  const autosave = createAutosave();
  const files = createConsultFiles({ post, io, projects: deps.projects, library, authorities: sourceAuthorities, autosave, logger: services.logger });
  return { handle: (message) => files.handle(message), dispose() { files.dispose(); autosave.dispose(); } };
}

function registerReaderPanelCommands(deps: PanelCommandsDeps): void {
  const { context, requireServices } = deps;

  context.subscriptions.push(
    vscode.commands.registerCommand("labshelf.openPdfViewer", async (paperId?: string, page?: number) => {
      const services = await requireServices();
      if (!services) { return; }
      const paper = await resolvePaper(services.paperService, paperId, "Open paper in the reader"); // no id (palette): the user picks
      if (!paper) { return; }
      // One guard covers every reader entry point (double-click, Enter, child
      // row, detail button, palette): a PDF-less paper warns and opens nothing.
      if (!(await ensurePaperPdf(services, paper))) { return; }
      PdfReaderPanel.createOrShow(readerPanelDeps(deps, services), paper, typeof page === "number" ? { page } : {});
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
  registerSourceEditor(deps.context, {
    extensionUri: deps.context.extensionUri, projects: deps.projects, logger: deps.logger, activeSource: deps.activeSource, editorPrefs: deps.editorPrefs,
    ...(deps.diskMerge ? { diskMerge: deps.diskMerge } : {}),
    // The same reader the writing view's citations use: no library open lists no papers.
    library: { listPapers: async () => await deps.currentServices()?.paperService.listPapers() ?? [] },
    highlightsOf: async (paperId) => await deps.currentServices()?.paperDataStore.getAnnotations(paperId) ?? [],
    // The reader command takes the page the citation names.
    openPaper: (paperId, page) => { void vscode.commands.executeCommand("labshelf.openPdfViewer", paperId, ...(page === undefined ? [] : [page])); },
    ...deps.sourceEditor,
    // Read when a panel opens: the controller provides it only on the desktop.
    comments: currentSourceFileComments,
    suggestions: currentSourceFileSuggestions,
    // Each project's review mode lives here, so it survives reopening a file.
    state: deps.context.workspaceState,
  });
}
