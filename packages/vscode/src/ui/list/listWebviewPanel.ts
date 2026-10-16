/**
 * Opens the editor tab that browses the library: a webview running the shared library UI, which this panel feeds with
 * snapshots, the open folder and OCR jobs, and answers through the typed message handlers.
 */
import * as vscode from 'vscode';
import { isUnderDir, type HostToUi, type PaperRecord, type TextLayerJobView } from '@labshelf/core';
import { rootNode, type LibraryNode } from '../library/index.js';
import { labshelfTabIcon } from '../tabIcon.js';
import { onPaperChange } from '../../events/index.js';
import { handleListMessage, type ListHostContext } from './host/index.js';
import { libraryPaths, type LibraryPaths } from './libraryPaths.js';
import { libraryBundleDirectory, listPanelHtml } from './listPanelHtml.js';
import type { ListPanelDeps } from './listPanelDeps.js';
import { readSnapshot } from './listSnapshots.js';

const RELOAD_DEBOUNCE_MS = 60;

export class ListWebviewPanel {
  public static currentPanel: ListWebviewPanel | undefined;

  private readonly _disposables: vscode.Disposable[] = [];
  private readonly _host: ListHostContext;
  private _folder: LibraryNode | undefined;
  /** The folder the UI shows, as the UI names it. */
  private _uiFolder: string | undefined;
  private _webviewReady = false;
  private _disposed = false;
  private _loadSeq = 0;
  private _lastNotified: string | undefined;
  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onSidecarEvent = ({ paperId }: { paperId: string }): void => {
    void this._post({ type: 'sidecarChanged', id: paperId });
    this._scheduleReload();
  };

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

  private constructor(private readonly _panel: vscode.WebviewPanel, private readonly _deps: ListPanelDeps, folder?: LibraryNode) {
    this._folder = folder;
    this._host = this._hostContext();
    // The shell is rendered once; folder changes and paper events arrive as messages, so the UI keeps its state.
    void listPanelHtml(this._panel.webview, _deps.extensionUri).then((html) => {
      if (!this._disposed) { this._panel.webview.html = html; }
    });
    this._panel.webview.onDidReceiveMessage((raw: unknown) => handleListMessage(this._host, raw), null, this._disposables);
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
    this._disposables.push(
      onPaperChange(_deps.events, () => this._scheduleReload()),
      // Annotations change the counts on the rows; closing the reader moves "last read".
      _deps.events.annotationChanged.event(this._onSidecarEvent),
      _deps.events.pdfViewerClosed.event(this._onSidecarEvent),
    );
    // Which projects cite the shown paper changed: the pane asks for its details again.
    if (_deps.projectBacklinks) {
      this._disposables.push(_deps.projectBacklinks.onDidChange(() => void this._post({ type: 'sidecarChanged', id: null })));
    }
    // Job updates arrive every page or two; they patch the rows without re-reading the index.
    if (_deps.textLayerJobs) {
      this._disposables.push(_deps.textLayerJobs.onDidChange((jobs) => void this._postJobs(jobs)));
    }
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

  private _paths(): LibraryPaths | null {
    const root = this._deps.getPapersRoot();
    return root ? libraryPaths(root, this._deps.pathOps) : null;
  }

  private _hostContext(): ListHostContext {
    return {
      deps: this._deps,
      paths: () => this._paths(),
      post: (m) => this._post(m),
      notice: (kind, text) => { void this._post({ type: 'notice', kind, text }); },
      papers: async (ids) => {
        const byId = new Map((await this._deps.paperService.listPapers()).map((p) => [p.id, p]));
        return ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
      },
      onReady: async () => { this._webviewReady = true; this._uiFolder = undefined; await this._pushState(); },
      onNavigate: (dir) => this._showFolder(this._nodeFor(dir), false),
    };
  }

  private async _post(message: HostToUi): Promise<void> {
    if (this._webviewReady && !this._disposed) { await this._panel.webview.postMessage(message); }
  }

  private async _postJobs(jobs: TextLayerJobView[]): Promise<void> {
    await this._post({ type: 'jobs', jobs });
  }

  private _scheduleReload(): void {
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      void this._pushState();
    }, RELOAD_DEBOUNCE_MS);
  }

  private _nodeFor(dirPath: string): LibraryNode {
    return dirPath === this._deps.getPapersRoot() ? rootNode(dirPath) : { label: this._deps.pathOps.basename(dirPath), dirPath };
  }

  // The folder to show, guarding against deleted folders and paths outside papers/.
  private async _resolveFolder(root: string): Promise<LibraryNode> {
    const wanted = this._folder;
    if (!wanted || wanted.isRoot || wanted.dirPath === root || !isUnderDir(wanted.dirPath, root, this._deps.pathOps.sep)) { return rootNode(root); }
    try {
      const stat = await vscode.workspace.fs.stat(vscode.Uri.file(wanted.dirPath));
      if (stat.type & vscode.FileType.Directory) { return { label: this._deps.pathOps.basename(wanted.dirPath), dirPath: wanted.dirPath }; }
    } catch {
      // The folder is gone: fall through to the root.
    }
    return rootNode(root);
  }

  // Shows `folder` in the tab title and the sidebar tree; `tellUi` also opens it in the UI when the UI is elsewhere.
  private _showFolder(folder: LibraryNode, tellUi: boolean): void {
    this._folder = folder;
    this._panel.title = folder.isRoot ? 'LabShelf' : folder.label;
    const ui = this._paths()?.toUi(folder.dirPath) ?? undefined;
    if (tellUi && ui && ui !== this._uiFolder) { void this._post({ type: 'navigate', folder: ui }); }
    this._uiFolder = ui;
    if (this._lastNotified !== folder.dirPath) {
      this._lastNotified = folder.dirPath;
      this._deps.onDidNavigate?.(folder);
    }
  }

  private async _pushState(): Promise<void> {
    const paths = this._paths();
    if (!paths || !this._webviewReady) { return; }
    const seq = ++this._loadSeq;
    const folder = await this._resolveFolder(paths.root);
    const snapshot = await readSnapshot(this._deps, paths);
    if (seq !== this._loadSeq || this._disposed) { return; }
    this._showFolder(folder, true);
    await this._post({ type: 'snapshot', snapshot });
    if (this._deps.textLayerJobs) { await this._postJobs(this._deps.textLayerJobs.current()); }
  }

  /** Clears the static panel reference, detaches event listeners, and disposes the webview panel. */
  public dispose(): void {
    // panel.dispose() below re-enters through onDidDispose.
    if (this._disposed) { return; }
    this._disposed = true;
    if (ListWebviewPanel.currentPanel === this) { ListWebviewPanel.currentPanel = undefined; }
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    this._panel.dispose();
    while (this._disposables.length) { this._disposables.pop()?.dispose(); }
  }
}
