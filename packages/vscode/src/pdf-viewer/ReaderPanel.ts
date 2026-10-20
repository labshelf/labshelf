/**
 * Creates and manages the reader webview panels, for library papers and build previews alike, and connects each one to the shared reader host controller.
 */
import * as vscode from "vscode";
import {
  ReaderHostController,
  type HostToWebview, type ILogger, type PaperRecord, type PreviewPorts, type ReaderCommandId, type ReaderSidecarStore, type SidecarChange,
} from "@labshelf/core";
import { autoReaderTheme, onAutoReaderThemeChange } from "./vscodeTheme.js";
import { renderReaderShell, getReaderBundleDirectory, type PdfjsFiles, type PdfjsLocator } from "./renderer/index.js";
import { READER_CONFIG_SECTION, getReaderPrefs, getReaderViewColumn } from "./readerPrefs.js";
import { createVsCodeOutputPorts } from "./readerHostPorts.js";
import { labshelfTabIcon } from "../ui/index.js";

// The contributed reader keybindings match this id in their `activeWebviewPanelId` when-clauses.
const READER_VIEW_TYPE = "labshelfPdf";

export interface ReaderPanelDeps {
  extensionUri: vscode.Uri;
  logger: ILogger;
  /** Finds the installed pdf.js the webview loads. */
  locatePdfjs: PdfjsLocator;
  /** Whether the host is macOS, which picks the reader's modifier key. */
  isMac: boolean;
}

/** What one reader panel shows and where its data lives. */
export interface ReaderSource {
  /** Opening a source whose key has a panel reveals that panel. */
  key: string;
  paper: PaperRecord;
  store: ReaderSidecarStore;
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

  /** Drives the reader of this panel: page jumps, reloads, build status and revealed points. */
  readonly controller: ReaderHostController;

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
    const resourceRoots: vscode.Uri[] = [getReaderBundleDirectory(deps.extensionUri), source.rootDir];
    if (pdfjs) { resourceRoots.push(pdfjs.root); }

    const show = source.show ?? getReaderViewColumn();
    const panel = vscode.window.createWebviewPanel(
      READER_VIEW_TYPE,
      source.paper.title,
      show,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: resourceRoots,
        // enableFindWidget stays off: VS Code's widget would swallow Ctrl/Cmd+F and search the chrome's DOM,
        // not the PDF text the reader's own find bar covers.
      },
    );
    panel.iconPath = labshelfTabIcon(deps.extensionUri);

    return new ReaderPanel(panel, deps, source, pdfjs);
  }

  private constructor(panel: vscode.WebviewPanel, deps: ReaderPanelDeps, source: ReaderSource, pdfjs: PdfjsFiles | null) {
    const { paper } = source;
    this._panel = panel;
    this.controller = new ReaderHostController({
      paper,
      store: source.store,
      post: (msg) => this._post(msg),
      getPrefs: getReaderPrefs,
      autoTheme: autoReaderTheme,
      ...createVsCodeOutputPorts(paper),
      logger: deps.logger,
      ...(source.sidecarChanged ? { sidecarChanged: source.sidecarChanged } : {}),
      ...(source.preview ? { preview: source.preview } : {}),
    }, source.page !== undefined ? { page: source.page } : {});
    openPanels.set(source.key, this);
    if (panel.active) { ReaderPanel.activePanel = this; if (!source.preview) { ReaderPanel._activated.fire(paper.id); } }

    panel.webview.onDidReceiveMessage((msg: unknown) => { void this.controller.handle(msg); }, null, this._disposables);

    // The shell is assigned as soon as the bundle check returns so the webview starts fetching pdf.js and the PDF;
    // everything that needs disk (theme, annotations, reading position) follows in the `init` reply.
    void renderReaderShell({
      webview: panel.webview,
      extensionUri: deps.extensionUri,
      pdfUri: source.pdfUri,
      paperId: paper.id,
      paperTitle: paper.title,
      preview: source.preview !== undefined,
      prefs: getReaderPrefs(),
      pdfjs,
      isMac: deps.isMac,
    }).then((html) => {
      if (!this._disposed) { panel.webview.html = html; }
    });

    this._subscribe(source);
  }

  /**
   * Shows another PDF in this panel; it must lie under the `rootDir` the panel was opened with.
   */
  showDocument(pdf: vscode.Uri, title: string): void {
    this._panel.title = title;
    this.controller.reloadDocument(this._panel.webview.asWebviewUri(pdf).toString());
  }

  reveal(preserveFocus = false): void {
    this._panel.reveal(undefined, preserveFocus);
  }

  private _subscribe(source: ReaderSource): void {
    this._disposables.push(onAutoReaderThemeChange((theme) => {
      this.controller.onAutoThemeChange(theme);
    }));
    this._disposables.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(READER_CONFIG_SECTION)) { this.controller.onPrefsChange(); }
    }));

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
