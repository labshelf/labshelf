/**
 * Creates and manages the reader webview panels, for library papers and build previews alike, and connects each one to the shared reader host controller.
 * Also holds the VS Code implementation of the reader host ports and the opener of library papers.
 */
import * as vscode from "vscode";
import {
  createPaperFiles,
  type ConsultInbound,
  type ConsultOutbound,
  type ExportAnnotationsPorts,
  type HostToWebview,
  type ILogger,
  type NoteFileIo,
  type NoticeKind,
  type PaperNotesStore,
  type PaperRecord,
  type PaperSidecarStore,
  type PreviewPorts,
  type ReaderCommandId,
  type ReaderHostPorts,
  type CiteReply,
  type CiteRequest,
  type ReaderSidecarStore,
  type ReaderThemeStore,
  type RunCellPort,
  type SidecarChange,
} from "@labshelf/core";
import type { LibraryEvents } from "../library/index.js";
import { createTabIcon, webviewChunksDir } from "../ui/index.js";
import { createReaderEndpoint, type ReaderEndpoint } from "./endpoint.js";
import { followPaperNotes, getReaderPrefs, getReaderViewColumn } from "./followNotes.js";
import { renderReaderShell, readReaderBundleDir, type PdfjsFiles, type PdfjsLocator } from "./shell.js";

export type VsCodeOutputPorts = Pick<ReaderHostPorts, "writeClipboard" | "notify" | "openExternal" | "saveAnnotations">;

/**
 * Confirmations go to the status bar so they never steal focus from the reader.
 */
export function showNoticeInVsCode(message: string, kind: NoticeKind): void {
  if (kind === "ok") {
    vscode.window.setStatusBarMessage(message, 2500);
  } else if (kind === "error") {
    void vscode.window.showErrorMessage(`LabShelf: ${message}`);
  } else {
    void vscode.window.showInformationMessage(message);
  }
}

/**
 * Asks where to save, defaulting to <paper folder>/annotations.md, then opens the file beside the reader.
 * @returns resolves once the file is written and shown, or at once when the dialog is cancelled.
 */
async function saveAnnotationsFile(paper: PaperRecord, markdown: string): Promise<void> {
  const uri = await vscode.window.showSaveDialog({
    defaultUri: vscode.Uri.joinPath(vscode.Uri.file(paper.path), "annotations.md"),
    filters: { Markdown: ["md"] },
  });
  if (!uri) { return; }
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(markdown));
  await vscode.window.showTextDocument(uri, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

/**
 * @returns the clipboard, notice, link and file ports for one paper.
 */
export function createVsCodeOutputPorts(paper: PaperRecord): VsCodeOutputPorts {
  return {
    writeClipboard: async (text) => { await vscode.env.clipboard.writeText(text); },
    notify: showNoticeInVsCode,
    openExternal: async (url) => { await vscode.env.openExternal(vscode.Uri.parse(url)); },
    saveAnnotations: (markdown) => saveAnnotationsFile(paper, markdown),
  };
}

/**
 * The ports the Markdown export needs outside a reader panel (the export palette command).
 * @returns export ports over the given sidecar store.
 */
export function createVsCodeExportPorts(paper: PaperRecord, store: ExportAnnotationsPorts["store"]): ExportAnnotationsPorts {
  return { paper, store, ...createVsCodeOutputPorts(paper) };
}

/**
 * The list webview listens for annotation events; theme changes concern only the reader.
 * @returns a sidecarChanged port that republishes annotation changes as an annotationChanged event.
 */
export function createSidecarChangeSender(events: LibraryEvents, paperId: string): (change: SidecarChange) => void {
  return (change) => {
    switch (change.kind) {
      case "annotationCreated":
      case "annotationUpdated":
      case "annotationDeleted": events.annotationChanged.fire({ paperId }); break;
      case "theme":
      case "customThemes": break;
    }
  };
}

// The contributed reader keybindings match this id in their `activeWebviewPanelId` when-clauses.
const READER_VIEW_TYPE = "labshelfPdf";

export interface ReaderPanelDeps {
  extensionUri: vscode.Uri;
  logger: ILogger;
  /** Finds the installed pdf.js the webview loads. */
  locatePdfjs: PdfjsLocator;
  /** Whether the host is macOS, which picks the reader's modifier key. */
  isMac: boolean;
  /** The reader's cite popup over the writing projects. */
  cite?: (paper: PaperRecord, request: CiteRequest) => Promise<CiteReply>;
  /** Runs a note's code cell and installs the Python it needs; the reader shows Run only when present. */
  runCell?: RunCellPort & { runMath?: NonNullable<ReaderHostPorts["runMath"]> };
  /** Stops the note's process of one language, so its next cell starts fresh. */
  restartCell?: NonNullable<ReaderHostPorts["restartCell"]>;
  installPython?: () => void;
  /** Serves the files beside the paper's notes (a chart's CSV, pasted images) from the paper's folder; the notes cannot import without it. */
  noteFileIo?: NoteFileIo;
  /** Reads an equation out of a box the user drew; the reader shows its equation tool only when present. */
  extractEquation?: NonNullable<ReaderHostPorts["extractEquation"]>;
  /** The library's papers for the notes' From paper…; absent where PDF regions cannot be rendered (the web), and the reader hides it. */
  paperObjects?: NonNullable<ReaderHostPorts["paperObjects"]>;
  /** Builds the panel's consult port over the panel's own post; absent where the reader offers no Consult (previews, version compare, the web). The panel disposes it when it closes. */
  consult?: (post: (message: ConsultInbound) => void) => { handle(message: ConsultOutbound): Promise<void>; dispose(): void };
}

/** What one reader panel shows and where its data lives. */
export interface ReaderSource {
  /** Opening a source whose key has a panel reveals that panel. */
  key: string;
  paper: PaperRecord;
  store: ReaderSidecarStore;
  /** The paper's notes; absent in a build preview, which shows no notes. */
  notes?: PaperNotesStore;
  /** The library's custom reader themes; absent in a build preview. */
  themes?: ReaderThemeStore;
  pdfUri: vscode.Uri;
  /** The folder the webview may read the PDF from. */
  rootDir: vscode.Uri;
  /** Present when the panel previews a build; it turns on the reader's build banner and source jumps. */
  preview?: PreviewPorts;
  sidecarChanged?: (change: SidecarChange) => void;
  /** Runs once when the panel closes. */
  onClosed?: () => void;
  /** Where to open; the reader's own setting when absent. */
  show?: vscode.ViewColumn | { viewColumn: vscode.ViewColumn; preserveFocus: boolean };
  /** Jump to this page once open (or immediately, when the panel already exists). */
  page?: number;
}

const openPanels = new Map<string, ReaderPanel>();

export class ReaderPanel {
  private static activePanel: ReaderPanel | undefined;
  private static readonly _activated = new vscode.EventEmitter<string>();
  /** Fires the paper id when a reader tab becomes active; build previews are not papers to show. */
  static readonly onDidActivatePaper = ReaderPanel._activated.event;

  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;
  private _closed = false;
  private _closeOut: () => void = () => {};
  /** This panel's reader host side (controller, settings, consult port), released in the close-out. */
  private readonly _endpoint: ReaderEndpoint;

  /** Drives the reader of this panel: page jumps, reloads, build status and revealed points. */
  readonly controller: ReaderEndpoint["controller"];

  /**
   * Clears the map of open panels — intended for use in tests only.
   */
  static _clearAllForTesting(): void {
    openPanels.clear();
    ReaderPanel.activePanel = undefined;
  }

  /**
   * Sends a reader command (contributed keybinding or palette command) to the focused reader panel.
   * @returns true when a reader panel was focused and received the command.
   */
  static postToActive(id: ReaderCommandId): boolean {
    const panel = ReaderPanel.activePanel;
    if (!panel || panel._disposed) { return false; }
    panel._post({ type: "command", id });
    return true;
  }

  /**
   * Reveals the panel of the source if one is open, or creates and initializes a new webview panel.
   */
  static createOrShow(deps: ReaderPanelDeps, source: ReaderSource): ReaderPanel {
    const existing = openPanels.get(source.key);
    if (existing) {
      // An open panel stays in its column; a source that must not take focus keeps the editor focused.
      existing.reveal(typeof source.show === "object" && source.show.preserveFocus);
      if (source.page !== undefined) { existing.controller.requestPage(source.page); }
      return existing;
    }

    const pdfjs = deps.locatePdfjs();
    const resourceRoots: vscode.Uri[] = [readReaderBundleDir(deps.extensionUri), webviewChunksDir(deps.extensionUri), source.rootDir];
    if (pdfjs) { resourceRoots.push(pdfjs.root); }

    const show = source.show ?? getReaderViewColumn();
    const panel = vscode.window.createWebviewPanel(
      READER_VIEW_TYPE,
      // The cite key keeps the tab narrow.
      source.paper.citeKey || source.paper.title,
      show,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
        // enableFindWidget stays off: VS Code's widget would swallow Ctrl/Cmd+F and search the chrome's DOM,
        // not the PDF text the reader's own find bar covers.
      },
    );
    panel.iconPath = createTabIcon(deps.extensionUri);

    return new ReaderPanel(panel, deps, source, pdfjs);
  }

  private constructor(panel: vscode.WebviewPanel, deps: ReaderPanelDeps, source: ReaderSource, pdfjs: PdfjsFiles | null) {
    const { paper } = source;
    this._panel = panel;
    this._endpoint = createReaderEndpoint(deps, source, {
      post: (msg) => this._post(msg),
      asWebviewUri: (uri) => this._panel.webview.asWebviewUri(uri),
      setTitle: (title) => { this._panel.title = title; },
      onToggleDetails: (paperId) => ReaderPanel._activated.fire(paperId),
    });
    this.controller = this._endpoint.controller;
    openPanels.set(source.key, this);
    if (panel.active) { ReaderPanel.activePanel = this; if (!source.preview) { ReaderPanel._activated.fire(paper.id); } }

    panel.webview.onDidReceiveMessage((msg: unknown) => { void this.controller.handle(msg); }, null, this._disposables);

    this._renderShell(deps, source, pdfjs);

    this._subscribe(source);
  }

  private _renderShell(deps: ReaderPanelDeps, source: ReaderSource, pdfjs: PdfjsFiles | null): void {
    // The shell is assigned as soon as the bundle check returns so the webview starts fetching pdf.js and the PDF;
    // everything that needs disk (theme, annotations, reading position) follows in the `init` reply.
    void renderReaderShell({
      webview: this._panel.webview,
      extensionUri: deps.extensionUri,
      pdfUri: source.pdfUri,
      paperId: source.paper.id,
      paperTitle: source.paper.title,
      citeKey: source.paper.citeKey,
      preview: source.preview !== undefined,
      prefs: getReaderPrefs(),
      pdfjs,
      isMac: deps.isMac,
    }).then((html) => {
      if (!this._disposed) { this._panel.webview.html = html; }
    });
  }

  /**
   * Shows another PDF in this panel; it must lie under the `rootDir` the panel was opened with.
   */
  showDocument(pdf: vscode.Uri, title: string): void {
    this._endpoint.showDocument(pdf, title);
  }

  reveal(preserveFocus = false): void {
    this._panel.reveal(undefined, preserveFocus);
  }

  private _subscribe(source: ReaderSource): void {
    // The reader's notes follow the paper's notes.qmd, whichever editor changes it; refreshNotes is deduped.
    if (source.notes && !source.preview) {
      this._disposables.push(followPaperNotes(source.paper.path, () => void this.controller.refreshNotes()));
    }

    this._panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        ReaderPanel.activePanel = this;
        if (!source.preview) { ReaderPanel._activated.fire(source.paper.id); }
      } else if (ReaderPanel.activePanel === this) {
        ReaderPanel.activePanel = undefined;
      }
    }, null, this._disposables);

    // INVARIANT: close-out runs exactly once, whether the user closes the tab or the host calls dispose().
    this._closeOut = () => {
      if (this._closed) { return; }
      this._closed = true;
      source.onClosed?.();
      this._endpoint.dispose();
      openPanels.delete(source.key);
      if (ReaderPanel.activePanel === this) { ReaderPanel.activePanel = undefined; }
    };
    this._panel.onDidDispose(() => { this._closeOut(); this.dispose(); }, null, this._disposables);
  }

  private _post(msg: HostToWebview): void {
    if (this._disposed) { return; }
    void this._panel.webview.postMessage(msg);
  }

  /**
   * Disposes all disposables and the underlying webview panel, guarded against double-disposal.
   */
  dispose(): void {
    if (this._disposed) { return; }
    this._disposed = true;
    this._closeOut();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    this._panel.dispose();
  }
}

export interface PdfReaderDeps extends ReaderPanelDeps {
  events: LibraryEvents;
  store: PaperSidecarStore;
  logger: ILogger;
  /** The library's paper notes, which the reader's Notes tab and text boxes read and write. */
  notes?: PaperNotesStore;
  /** The library's custom reader themes. */
  themes?: ReaderThemeStore;
}

export interface OpenOptions {
  /** Jump to this page once open (or immediately, when the paper's panel already exists). */
  page?: number;
}

export class PdfReaderPanel {
  /**
   * Reveals the paper's panel if one is open, or opens a new one keyed by the paper id.
   */
  static createOrShow(deps: PdfReaderDeps, paper: PaperRecord, options: OpenOptions = {}): void {
    const paperDirUri = vscode.Uri.file(paper.path);
    ReaderPanel.createOrShow(deps, {
      key: paper.id,
      paper,
      store: deps.store,
      ...(deps.notes ? { notes: deps.notes } : {}),
      ...(deps.themes ? { themes: deps.themes } : {}),
      pdfUri: createPaperFiles(paperDirUri, vscode.Uri.joinPath).pdf,
      rootDir: paperDirUri,
      sidecarChanged: createSidecarChangeSender(deps.events, paper.id),
      onClosed: () => deps.events.pdfViewerClosed.fire({ paperId: paper.id }),
      ...(options.page !== undefined ? { page: options.page } : {}),
    });
  }
}
