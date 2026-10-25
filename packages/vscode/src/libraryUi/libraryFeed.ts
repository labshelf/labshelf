// Pushes the library snapshot, OCR jobs and change notices to one webview, and re-pushes when the library changes.
import type * as vscode from 'vscode';
import {
  type HostToUi,
  createSidecarReader,
  deriveFolderTree,
  type LibraryUiSnapshot,
  type PaperRecord,
} from '@labshelf/core';
import { onPaperChange } from '../library/index.js';
import { createLibraryPaths, type LibraryPaths } from './createLibraryPaths.js';
import type { ListPanelDeps } from './listPanelDeps.js';

const LOG_MODULE = 'libraryUi/listSnapshots';

/** A failed index read becomes an empty library, logged, so the panel stays usable. */
async function readPapers(deps: ListPanelDeps): Promise<PaperRecord[]> {
  try {
    return await deps.paperService.listPapers();
  } catch (error) {
    await deps.logger.log('WARN', LOG_MODULE, 'Index could not be read for the list', { message: String(error) });
    return [];
  }
}

async function readSnapshot(deps: ListPanelDeps, paths: LibraryPaths): Promise<LibraryUiSnapshot> {
  const records = await readPapers(deps);
  const papers: PaperRecord[] = [];
  for (const record of records) {
    const ui = paths.toUi(record.path);
    if (ui) { papers.push({ ...record, path: ui }); }
  }
  const stats = deps.loadSidecar ? await createSidecarReader(deps.loadSidecar, deps.logger, LOG_MODULE).statsOf(records) : {};
  const folders = deriveFolderTree(deps.getSnapshot());
  // A record says nothing about its PDF until the indexer has looked; that counts as present.
  const pdfDirs = papers.filter((p) => p.hasPdf !== false).map((p) => p.path);
  return { folders, papers, pdfDirs, stats };
}

// The state push on ready resends these with fresh values, so a held copy would only overwrite them with stale ones.
const RESENT_ON_READY: ReadonlySet<HostToUi['type']> = new Set(['snapshot', 'navigate', 'jobs', 'sidecarChanged']);

class ReadyQueue {
  private _ready = false;
  private _closed = false;
  private _held: HostToUi[] = [];

  constructor(private readonly _send: (message: HostToUi) => Thenable<unknown>) {}

  get ready(): boolean {
    return this._ready;
  }

  async post(message: HostToUi): Promise<void> {
    if (this._closed) { return; }
    if (this._ready) { await this._send(message); return; }
    if (!RESENT_ON_READY.has(message.type)) { this._held.push(message); }
  }

  /** From here on messages go straight to the webview. */
  markReady(): void {
    this._ready = true;
  }

  /** Sends what was held before ready; called after the state push so the UI already has the library. */
  async flush(): Promise<void> {
    const held = this._held;
    this._held = [];
    for (const message of held) { await this.post(message); }
  }

  /** Drops what is held; the webview is gone. */
  close(): void {
    this._closed = true;
    this._held = [];
  }
}

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
    return root ? createLibraryPaths(root, this._deps.pathOps) : null;
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
