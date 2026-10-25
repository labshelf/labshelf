// Pushes the library snapshot, OCR jobs and change notices to one webview, and re-pushes when the library changes.
import type * as vscode from 'vscode';
import type { HostToUi } from '@labshelf/core';
import { onPaperChange } from '../library/index.js';
import { libraryPaths, type LibraryPaths } from './libraryPaths.js';
import type { ListPanelDeps } from './listPanelDeps.js';
import { readSnapshot } from './listSnapshots.js';
import { ReadyQueue } from './heldMessages.js';

const RELOAD_DEBOUNCE_MS = 60;

/** Runs before a snapshot is posted and returns what to apply once the snapshot is known to be current. */
export type BeforeSnapshot = () => Promise<() => void>;

export class LibraryFeed implements vscode.Disposable {
  readonly queue: ReadyQueue;
  private readonly _subscriptions: vscode.Disposable[] = [];
  private _loadSeq = 0;
  private _disposed = false;
  private _reloadTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _onSidecarEvent = ({ paperId }: { paperId: string }): void => {
    void this.queue.post({ type: 'sidecarChanged', id: paperId });
    this.scheduleReload();
  };

  constructor(private readonly _deps: ListPanelDeps, send: (message: HostToUi) => Thenable<unknown>, private readonly _beforeSnapshot?: BeforeSnapshot) {
    this.queue = new ReadyQueue(send);
    this._subscriptions.push(
      onPaperChange(_deps.events, () => this.scheduleReload()),
      // Annotations change the counts on the rows; closing the reader moves "last read".
      _deps.events.annotationChanged.event(this._onSidecarEvent),
      _deps.events.pdfViewerClosed.event(this._onSidecarEvent),
    );
    // Which projects cite the shown paper changed: the pane asks for its details again.
    if (_deps.projectBacklinks) {
      this._subscriptions.push(_deps.projectBacklinks.onDidChange(() => void this.queue.post({ type: 'sidecarChanged', id: null })));
    }
    // Job updates arrive every page or two; they patch the rows without re-reading the index.
    if (_deps.textLayerJobs) {
      this._subscriptions.push(_deps.textLayerJobs.onDidChange((jobs) => void this.queue.post({ type: 'jobs', jobs })));
    }
  }

  /** The path mapping of the open library, or null while none is configured. */
  paths(): LibraryPaths | null {
    const root = this._deps.getPapersRoot();
    return root ? libraryPaths(root, this._deps.pathOps) : null;
  }

  /** Reads the library and posts the snapshot and jobs; a push that a newer one overtook posts nothing. */
  async push(): Promise<void> {
    const paths = this.paths();
    if (!paths || !this.queue.ready) { return; }
    const seq = ++this._loadSeq;
    const apply = await this._beforeSnapshot?.();
    const snapshot = await readSnapshot(this._deps, paths);
    if (seq !== this._loadSeq || this._disposed) { return; }
    apply?.();
    await this.queue.post({ type: 'snapshot', snapshot });
    if (this._deps.textLayerJobs) { await this.queue.post({ type: 'jobs', jobs: this._deps.textLayerJobs.current() }); }
  }

  scheduleReload(): void {
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    this._reloadTimer = setTimeout(() => {
      this._reloadTimer = null;
      void this.push();
    }, RELOAD_DEBOUNCE_MS);
  }

  dispose(): void {
    this._disposed = true;
    this.queue.close();
    if (this._reloadTimer) { clearTimeout(this._reloadTimer); }
    while (this._subscriptions.length) { this._subscriptions.pop()?.dispose(); }
  }
}
