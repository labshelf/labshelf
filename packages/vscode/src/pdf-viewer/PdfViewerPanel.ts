/**
 * Creates and manages the PDF reader webview panels and connects each one to the shared reader host controller.
 */
import * as vscode from "vscode";
import { ReaderHostController, paperFiles, type EffectiveTheme, type HostToWebview, type ILogger, type PaperDataStore, type PaperRecord, type ReaderCommandId } from "@labshelf/core";
import { ThemeManager } from "./ThemeManager.js";
import { PdfRenderer, getReaderBundleDirectory, type PdfjsFiles, type PdfjsLocator } from "./renderer/index.js";
import { READER_CONFIG_SECTION, getReaderPrefs, getReaderViewColumn } from "./readerPrefs.js";
import { createVsCodeOutputPorts, emitSidecarChanges } from "./readerHostPorts.js";
import { labshelfTabIcon } from "../ui/index.js";
import { EventBus, EVENTS } from "../events/index.js";

// The contributed reader keybindings match this id in their `activeWebviewPanelId` when-clauses.
const READER_VIEW_TYPE = "labshelfPdf";

export interface PdfViewerDeps {
  extensionUri: vscode.Uri;
  eventBus: EventBus;
  themeManager: ThemeManager;
  store: PaperDataStore;
  logger: ILogger;
  /** Finds the installed pdf.js the webview loads. */
  locatePdfjs: PdfjsLocator;
  /** Whether the host is macOS, which picks the reader's modifier key. */
  isMac: boolean;
  /** Reading analytics sink (the AI subsystem's reading_events), absent when AI is disabled. */
}

export interface OpenOptions {
  /** Jump to this page once open (or immediately, when the paper's panel already exists). */
  page?: number;
}

// Open panels by paperId, so opening a paper again reveals its panel instead of creating another.
const openPanels = new Map<string, PdfViewerPanel>();

export class PdfViewerPanel {
  private static activePanel: PdfViewerPanel | undefined;

  private readonly _panel: vscode.WebviewPanel;
  private readonly _controller: ReaderHostController;
  private _disposables: vscode.Disposable[] = [];
  private _disposed = false;
  private _closed = false;

  /**
   * Clears the map of open panels — intended for use in tests only.
   */
  static _clearAllForTesting(): void {
    openPanels.clear();
    PdfViewerPanel.activePanel = undefined;
  }

  /**
   * Sends a reader command (contributed keybinding or palette command) to the focused reader panel.
   * @returns true when a reader panel was focused and received the command.
   */
  static postToActive(id: ReaderCommandId): boolean {
    const panel = PdfViewerPanel.activePanel;
    if (!panel || panel._disposed) { return false; }
    panel._post({ type: "command", id });
    return true;
  }

  /**
   * Reveals an existing panel for the paper if one is open, or creates and initializes a new webview panel.
   */
  static createOrShow(deps: PdfViewerDeps, paper: PaperRecord, options: OpenOptions = {}): void {
    const existing = openPanels.get(paper.id);
    if (existing) {
      existing._panel.reveal();
      if (options.page !== undefined) { existing._controller.requestPage(options.page); }
      return;
    }

    const paperDirUri = vscode.Uri.file(paper.path);
    const pdfUri = paperFiles(paperDirUri, vscode.Uri.joinPath).pdf;
    const pdfjs = deps.locatePdfjs();
    const resourceRoots: vscode.Uri[] = [getReaderBundleDirectory(deps.extensionUri), paperDirUri];
    if (pdfjs) { resourceRoots.push(pdfjs.root); }

    const panel = vscode.window.createWebviewPanel(
      READER_VIEW_TYPE,
      paper.title,
      getReaderViewColumn(),
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
        // enableFindWidget stays off: VS Code's widget would swallow Ctrl/Cmd+F and search the chrome's DOM,
        // not the PDF text the reader's own find bar covers.
      },
    );
    panel.iconPath = labshelfTabIcon(deps.extensionUri);

    new PdfViewerPanel(panel, deps, pdfUri, paper, options, pdfjs);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    deps: PdfViewerDeps,
    pdfUri: vscode.Uri,
    paper: PaperRecord,
    options: OpenOptions,
    pdfjs: PdfjsFiles | null,
  ) {
    this._panel = panel;
    this._controller = new ReaderHostController({
      paper,
      store: deps.store,
      post: (msg) => this._post(msg),
      getPrefs: getReaderPrefs,
      autoTheme: () => deps.themeManager.getEffectiveTheme("auto") as EffectiveTheme,
      ...createVsCodeOutputPorts(paper),
      logger: deps.logger,
      sidecarChanged: emitSidecarChanges(deps.eventBus, paper.id),
    }, options.page !== undefined ? { page: options.page } : {});
    openPanels.set(paper.id, this);
    if (panel.active) { PdfViewerPanel.activePanel = this; }

    panel.webview.onDidReceiveMessage((msg: unknown) => { void this._controller.handle(msg); }, null, this._disposables);

    // The shell is assigned as soon as the bundle check returns so the webview starts fetching pdf.js and the PDF;
    // everything that needs disk (theme, annotations, reading position) follows in the `init` reply.
    void new PdfRenderer().generateHtml({
      webview: panel.webview,
      extensionUri: deps.extensionUri,
      pdfUri,
      paperId: paper.id,
      paperTitle: paper.title,
      themeManager: deps.themeManager,
      themePreference: "auto",
      prefs: getReaderPrefs(),
      pdfjs,
      isMac: deps.isMac,
    }).then((html) => {
      if (!this._disposed) { panel.webview.html = html; }
    });

    this._subscribe(deps, paper);
  }

  private _subscribe(deps: PdfViewerDeps, paper: PaperRecord): void {
    this._disposables.push(deps.themeManager.onVsCodeThemeChange((theme) => {
      this._controller.onAutoThemeChange(theme as EffectiveTheme);
    }));
    this._disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(READER_CONFIG_SECTION)) { this._controller.onPrefsChange(); }
    }));

    this._panel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        PdfViewerPanel.activePanel = this;
      } else if (PdfViewerPanel.activePanel === this) {
        PdfViewerPanel.activePanel = undefined;
      }
    }, null, this._disposables);

    this._panel.onDidDispose(() => {
      // dispose() below re-enters panel.dispose(); close-out must happen exactly once.
      if (this._closed) { return; }
      this._closed = true;
      deps.eventBus.emit(EVENTS.PDF_VIEWER_CLOSED, { paperId: paper.id, timestamp: new Date().toISOString() });
      openPanels.delete(paper.id);
      if (PdfViewerPanel.activePanel === this) { PdfViewerPanel.activePanel = undefined; }
      this.dispose();
    }, null, this._disposables);
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
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
    this._panel.dispose();
  }
}
