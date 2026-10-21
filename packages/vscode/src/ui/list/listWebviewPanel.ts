/**
 * Opens the editor tab that browses the library: a webview running the shared library UI, which this panel feeds with
 * snapshots, the open folder and OCR jobs, and answers through the typed message handlers.
 */
import * as vscode from 'vscode';
import { isUnderDir } from '@labshelf/core';
import { sharingWebviews } from '../../sharing/index.js';
import { rootNode, type LibraryNode } from '../library/index.js';
import { labshelfTabIcon } from '../tabIcon.js';
import { handleListMessage, showCitationMap, type ListHostContext } from './host/index.js';
import { feedHostContext, LibraryFeed } from './feed/index.js';
import { libraryBundleDirectory, listPanelHtml } from './listPanelHtml.js';
import type { ListPanelDeps } from './listPanelDeps.js';
import { resolveShownFolder } from './shownFolder.js';

export class ListWebviewPanel {
  public static currentPanel: ListWebviewPanel | undefined;

  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _host: ListHostContext;
  private _folder: LibraryNode | undefined;
  /** The folder the UI shows, as the UI names it. */
  private _uiFolder: string | undefined;
  private readonly _feed: LibraryFeed;
  private _disposed = false;
  private _citationMapRequested = false;
  private _lastNotified: string | undefined;

  /** Reveals the open list panel, or opens one, on the given folder (papers/ when omitted). */
  public static createOrShow(deps: ListPanelDeps, folder?: LibraryNode): void {
    if (ListWebviewPanel.currentPanel) {
      ListWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      void ListWebviewPanel.currentPanel.navigateTo(folder);
      return;
    }
    const panel = vscode.window.createWebviewPanel('labshelfList', folder?.label ?? 'LabShelf', vscode.ViewColumn.One, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [libraryBundleDirectory(deps.extensionUri)],
    });
    panel.iconPath = labshelfTabIcon(deps.extensionUri);
    ListWebviewPanel.currentPanel = new ListWebviewPanel(panel, deps, folder);
  }

  /** Reveals or opens the panel and shows the citation map in it, once the UI is ready. */
  public static showCitationMap(deps: ListPanelDeps): void {
    const panel = ListWebviewPanel._revealOrOpen(deps);
    if (panel?._feed.queue.ready) { void showCitationMap(panel._host); } else if (panel) { panel._citationMapRequested = true; }
  }

  /** Reveals or opens the panel, without changing its folder, and selects the paper once the UI is ready. */
  public static async revealPaper(deps: ListPanelDeps, id: string): Promise<void> {
    await ListWebviewPanel._revealOrOpen(deps)?._feed.queue.post({ type: 'reveal', id });
  }

  /** Brings the panel forward and searches for papers with this tag. */
  public static async showTag(deps: ListPanelDeps, tag: string): Promise<void> {
    await ListWebviewPanel._revealOrOpen(deps)?._feed.queue.post({ type: 'searchTag', tag });
  }

  // Brings the panel forward on whatever folder it shows; createOrShow would navigate it.
  private static _revealOrOpen(deps: ListPanelDeps): ListWebviewPanel | undefined {
    if (ListWebviewPanel.currentPanel) { ListWebviewPanel.currentPanel._panel.reveal(vscode.ViewColumn.One); } else { ListWebviewPanel.createOrShow(deps); }
    return ListWebviewPanel.currentPanel;
  }

  private constructor(private readonly _panel: vscode.WebviewPanel, private readonly _deps: ListPanelDeps, folder?: LibraryNode) {
    this._folder = folder;
    this._feed = new LibraryFeed(_deps, (message) => this._panel.webview.postMessage(message), () => this._resolveFolder());
    this._host = this._hostContext();
    // The shell is rendered once; folder changes and paper events arrive as messages, so the UI keeps its state.
    void listPanelHtml(this._panel.webview, _deps.extensionUri).then((html) => {
      if (!this._disposed) { this._panel.webview.html = html; }
    });
    this._panel.webview.onDidReceiveMessage((raw: unknown) => handleListMessage(this._host, raw), null, this._disposables);
    this._disposables.push(sharingWebviews.attach(this._panel.webview));
    this._panel.onDidChangeViewState((e) => { if (e.webviewPanel.active) { this._deps.onDidActivate?.(); } }, null, this._disposables);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  /** The folder shown, so the sidebar tree can select it. */
  public get currentFolder(): LibraryNode | undefined {
    return this._folder;
  }

  /** Shows the given folder; anything missing or outside papers/ falls back to the library root. */
  public async navigateTo(folder?: LibraryNode): Promise<void> {
    this._folder = folder;
    await this._pushState();
  }

  /** Re-reads the library; called after folders are created, renamed, moved or deleted. */
  public async refresh(): Promise<void> {
    await this._pushState();
  }

  /** Keeps the panel on the same folder after it (or one of its ancestors) moved from oldDir to newDir. */
  public async followFolderMove(oldDir: string, newDir: string): Promise<void> {
    const current = this._folder;
    if (current && !current.isRoot && isUnderDir(current.dirPath, oldDir, this._deps.pathOps.sep)) {
      const dirPath = newDir + current.dirPath.slice(oldDir.length);
      this._folder = { label: this._deps.pathOps.basename(dirPath), dirPath };
    }
    await this._pushState();
  }

  private _hostContext(): ListHostContext {
    return feedHostContext(this._deps, this._feed, {
      onReady: async () => {
        this._feed.queue.markReady(); this._uiFolder = undefined;
        await this._pushState();
        await this._feed.queue.flush();
        if (this._citationMapRequested) { this._citationMapRequested = false; await showCitationMap(this._host); }
      },
      onNavigate: (dir) => this._showFolder(this._nodeFor(dir), false),
      onSelect: (ids) => {
        if (ids.length === 1) { this._deps.onDidSelectPaper?.(ids[0]!); }
        this._deps.onDidChangeSelection?.(ids);
      },
    });
  }

  private _nodeFor(dirPath: string): LibraryNode {
    return dirPath === this._deps.getPapersRoot() ? rootNode(dirPath) : { label: this._deps.pathOps.basename(dirPath), dirPath };
  }

  // Shows `folder` in the tab title and the sidebar tree; `tellUi` also opens it in the UI when the UI is elsewhere.
  private _showFolder(folder: LibraryNode, tellUi: boolean): void {
    this._folder = folder;
    this._panel.title = folder.isRoot ? 'LabShelf' : folder.label;
    const ui = this._feed.paths()?.toUi(folder.dirPath) ?? undefined;
    if (tellUi && ui && ui !== this._uiFolder) { void this._feed.queue.post({ type: 'navigate', folder: ui }); }
    this._uiFolder = ui;
    if (this._lastNotified !== folder.dirPath) {
      this._lastNotified = folder.dirPath;
      this._deps.onDidNavigate?.(folder);
    }
  }

  private async _pushState(): Promise<void> {
    await this._feed.push();
  }

  // The folder is resolved while the snapshot is read; it is shown only if no newer push overtook this one.
  private async _resolveFolder(): Promise<() => void> {
    const root = this._feed.paths()?.root;
    const folder = root ? await resolveShownFolder(this._folder, root, this._deps.pathOps) : undefined;
    return () => { if (folder) { this._showFolder(folder, true); } };
  }

  /** Clears the static panel reference, detaches event listeners, and disposes the webview panel. */
  public dispose(): void {
    // panel.dispose() below re-enters through onDidDispose.
    if (this._disposed) { return; }
    this._disposed = true;
    this._feed.dispose();
    if (ListWebviewPanel.currentPanel === this) { ListWebviewPanel.currentPanel = undefined; }
    this._panel.dispose();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
  }
}
