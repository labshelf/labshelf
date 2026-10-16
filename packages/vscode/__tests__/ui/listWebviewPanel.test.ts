import * as path from 'node:path';
import * as vscode from 'vscode';
import { snapshotFromScan, type HostToUi, type LibraryUiSnapshot, type PaperEntry, type PaperRecord } from '@labshelf/core';
import { ListWebviewPanel } from '../../src/ui/list/listWebviewPanel';
import { createLibraryEvents } from '../../src/events/index';
import type { ListPanelDeps } from '../../src/ui/list/listPanelDeps';
import type { LibraryNode } from '../../src/ui/library/index';
import type { TextLayerJob } from '../../src/commands/textLayerQueue';

const ROOT = '/lib/papers';
type Failure = { id: string; error: string };
const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function paper(id: string, dir: string, extra: Record<string, unknown> = {}) {
  return { id, title: `Title ${id}`, path: `${dir}/${id}`, citeKey: `key-${id}`, authors: [], status: 'unread', ...extra };
}

function open(folder?: LibraryNode, extra: Partial<ListPanelDeps> = {}) {
  const paperService = {
    listPapers: jest.fn(async () => [paper('p1', `${ROOT}/A`), paper('p2', `${ROOT}/A/B`, { hasPdf: false }), paper('p3', ROOT)]),
    movePapers: jest.fn(async (ids: string[]) => ({ done: ids, failed: [] as Failure[], moves: [] })),
    updatePapersStatus: jest.fn(async () => [] as string[]),
    updatePaperFields: jest.fn(async (id: string) => ({ id })),
    trashPapers: jest.fn(async (ids: string[]) => ({ done: ids, failed: [] as Failure[] })),
    editTags: jest.fn(async (ids: string[]) => ({ done: ids, failed: [] })),
  };
  const bus = createLibraryEvents();
  const folders = { create: jest.fn(async () => {}), rename: jest.fn(async () => {}), trash: jest.fn(async () => {}) };
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const onDidNavigate = jest.fn();
  const entry = (id: string, collection: string): PaperEntry => ({ record: { id } as PaperRecord, collection, modifiedMs: 0 });
  const library = snapshotFromScan(ROOT, { folders: ['A', 'A/B'], papers: [entry('p1', 'A'), entry('p2', 'A/B'), entry('p3', '')], orphans: [], duplicates: [] }, 0);
  const getSnapshot = () => library;
  const deps = {
    extensionUri: vscode.Uri.file('/ext'), paperService, events: bus, logger, pathOps: path, folders, onDidNavigate, getSnapshot,
    getPapersRoot: () => ROOT, ...extra,
  } as unknown as ListPanelDeps;

  ListWebviewPanel.createOrShow(deps, folder);
  const created = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)?.value;
  const posted = (): HostToUi[] => (created.webview.postMessage as jest.Mock).mock.calls.map(([m]) => m as HostToUi);
  const last = <T extends HostToUi['type']>(type: T) => posted().filter((m) => m.type === type).at(-1) as Extract<HostToUi, { type: T }> | undefined;
  return {
    deps, paperService, bus, folders, logger, onDidNavigate, created, posted, last,
    snapshot: (): LibraryUiSnapshot => last('snapshot')!.snapshot,
    fire: async (msg: unknown) => { created.webview._fireMessage(msg); await flush(); await flush(); },
  };
}

beforeEach(() => {
  ListWebviewPanel.currentPanel?.dispose();
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory, size: 2048 });
});

describe('ListWebviewPanel — snapshots and folders', () => {
  it('waits for the webview handshake, then opens the folder and sends the library in UI paths', async () => {
    const h = open();
    await flush();
    expect(h.posted()).toEqual([]);

    await h.fire({ type: 'ready' });
    expect(h.posted().map((m) => m.type)).toEqual(['navigate', 'snapshot']);
    expect(h.last('navigate')).toEqual({ type: 'navigate', folder: 'papers' });
    const snap = h.snapshot();
    expect(snap.papers.map((p) => p.path)).toEqual(['papers/A/p1', 'papers/A/B/p2', 'papers/p3']);
    expect(snap.pdfDirs).toEqual(['papers/A/p1', 'papers/p3']);
    expect(snap.folders).toEqual([{ name: 'A', path: 'papers/A', total: 2, children: [{ name: 'B', path: 'papers/A/B', total: 1, children: [] }] }]);
  });

  it('carries each paper\'s reading stats from its sidecar', async () => {
    const loadSidecar = jest.fn(async (id: string) => (id === 'p1'
      ? { annotations: [{}, {}], reading: { page: 4, updatedAt: '2024-01-01T00:00:00Z' } }
      : { annotations: [] }));
    const h = open(undefined, { loadSidecar } as unknown as Partial<ListPanelDeps>);
    await h.fire({ type: 'ready' });
    expect(h.snapshot().stats['p1']).toEqual({ annotations: 2, lastPage: 4, lastRead: '2024-01-01T00:00:00Z' });
  });

  it('follows the UI into a folder, tells the sidebar and renames the tab, without echoing navigate', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    const before = h.posted().length;
    await h.fire({ type: 'navigate', folder: 'papers/A' });
    expect(h.onDidNavigate).toHaveBeenLastCalledWith({ label: 'A', dirPath: `${ROOT}/A` });
    expect(h.created.title).toBe('A');
    expect(h.posted().length).toBe(before);
    expect(ListWebviewPanel.currentPanel?.currentFolder?.dirPath).toBe(`${ROOT}/A`);
  });

  it('opens the folder the extension asks for in the UI', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await ListWebviewPanel.currentPanel?.navigateTo({ label: 'B', dirPath: `${ROOT}/A/B` });
    expect(h.last('navigate')).toEqual({ type: 'navigate', folder: 'papers/A/B' });
  });

  it('refuses messages that are not valid, among them paths outside papers/', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'navigate', folder: '/etc' });
    await h.fire({ type: 'paper.move', ids: ['p1'], target: 'papers/../..' });
    await h.fire({ command: 'deletePaper', paperId: 'p1' });
    expect(h.onDidNavigate).toHaveBeenCalledTimes(1);
    expect(h.paperService.movePapers).not.toHaveBeenCalled();
    expect(h.paperService.trashPapers).not.toHaveBeenCalled();
    expect(h.logger.log).toHaveBeenCalledWith('WARN', 'ui/list', 'List webview sent a message that is not valid', expect.anything());
  });

  it('falls back to the root when the folder no longer exists', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('gone'));
    const h = open({ label: 'Gone', dirPath: `${ROOT}/Gone` });
    await h.fire({ type: 'ready' });
    expect(h.last('navigate')).toEqual({ type: 'navigate', folder: 'papers' });
  });

  it('follows its folder when an ancestor is renamed or moved', async () => {
    const h = open({ label: 'B', dirPath: `${ROOT}/A/B` });
    await h.fire({ type: 'ready' });
    await ListWebviewPanel.currentPanel?.followFolderMove(`${ROOT}/A`, `${ROOT}/Renamed`);
    expect(ListWebviewPanel.currentPanel?.currentFolder?.dirPath).toBe(`${ROOT}/Renamed/B`);
  });

  it('creates, renames and trashes folders on disk paths', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'folder.create', parent: 'papers/A', name: 'New' });
    await h.fire({ type: 'folder.rename', path: 'papers/A/B', name: 'C' });
    await h.fire({ type: 'folder.delete', path: 'papers/A' });
    expect(h.folders.create).toHaveBeenCalledWith(`${ROOT}/A`, 'New');
    expect(h.folders.rename).toHaveBeenCalledWith(`${ROOT}/A/B`, 'C');
    expect(h.folders.trash).toHaveBeenCalledWith(`${ROOT}/A`);
  });

  it('turns a failed folder change into an error notice', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    h.folders.create.mockRejectedValueOnce(new Error('A folder named "New" already exists'));
    await h.fire({ type: 'folder.create', parent: 'papers', name: 'New' });
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'error', text: 'Could not create the folder — A folder named "New" already exists' });
  });

  it('detaches its event listeners on dispose', () => {
    const h = open();
    ListWebviewPanel.currentPanel?.dispose();
    const before = h.posted().length;
    h.bus.annotationChanged.fire({ paperId: 'p1' });
    h.bus.pdfViewerClosed.fire({ paperId: 'p1' });
    expect(h.posted()).toHaveLength(before);
    expect(ListWebviewPanel.currentPanel).toBeUndefined();
  });
});

describe('ListWebviewPanel — paper actions', () => {
  it('adds papers into the folder being viewed', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.add', folder: 'papers/A' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('labshelf.addPaperHere', { label: 'A', dirPath: `${ROOT}/A` });
  });

  it('moves papers into a folder and says where', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.move', ids: ['p1'], target: 'papers/A/B' });
    expect(h.paperService.movePapers).toHaveBeenCalledWith(['p1'], `${ROOT}/A/B`);
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'ok', text: '1 paper moved to B' });
    h.paperService.movePapers.mockResolvedValue({ done: [], failed: [{ id: 'p1', error: 'exists' }], moves: [] });
    await h.fire({ type: 'paper.move', ids: ['p1'], target: 'papers' });
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'error', text: '0 moved, 1 failed — "Title p1" — exists' });
  });

  it('moves removed papers to the trash and keeps a paper whose trash failed', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.remove', ids: ['p1'] });
    expect(h.paperService.trashPapers).toHaveBeenCalledWith(['p1']);
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'ok', text: 'Removed "Title p1"' });
    h.paperService.trashPapers.mockResolvedValue({ done: [], failed: [{ id: 'p1', error: 'EPERM' }] });
    await h.fire({ type: 'paper.remove', ids: ['p1'] });
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'error', text: '0 removed, 1 failed — "Title p1" — EPERM' });
  });

  it('routes status, tags and notes to the paper service', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.setStatus', ids: ['p1', 'p3'], status: 'done' });
    await h.fire({ type: 'paper.setTags', ids: ['p1', 'p2'], add: ['nlp '], remove: ['old'] });
    await h.fire({ type: 'paper.setNote', id: 'p1', note: 'Key idea' });
    expect(h.paperService.updatePapersStatus).toHaveBeenCalledWith(['p1', 'p3'], 'done');
    expect(h.paperService.editTags).toHaveBeenCalledWith(['p1', 'p2'], ['nlp'], ['old']);
    expect(h.paperService.updatePaperFields).toHaveBeenCalledWith('p1', { note: 'Key idea' });
  });

  it('writes the clipboard and says what was copied', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'clipboard.write', text: 'key-p1,key-p3', label: '2 × cite key' });
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('key-p1,key-p3');
    expect(h.last('notice')).toEqual({ type: 'notice', kind: 'ok', text: 'Copied 2 × cite key' });
  });

  it('runs the extension commands for reading, OCR, metadata and export', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.open', id: 'p1', page: 3 });
    await h.fire({ type: 'paper.makeSearchable', ids: ['p2', 'p3'] });
    await h.fire({ type: 'paper.fetchMetadata', id: 'p1' });
    await h.fire({ type: 'annotations.export', id: 'p1' });
    await h.fire({ type: 'paper.reveal', id: 'p1' });
    const calls = (vscode.commands.executeCommand as jest.Mock).mock.calls;
    expect(calls).toContainEqual(['labshelf.openPdfViewer', 'p1', 3]);
    expect(calls).toContainEqual(['labshelf.makeSearchable', ['p2', 'p3']]);
    expect(calls).toContainEqual(['labshelf.fetchMetadata', 'p1']);
    expect(calls).toContainEqual(['labshelf.exportAnnotations', 'p1', 'file']);
    expect(calls).toContainEqual(['revealInExplorer', expect.objectContaining({ fsPath: `${ROOT}/A/p1` })]);
  });
});

describe('ListWebviewPanel — per-paper data', () => {
  it('answers details with the annotations, the reading position and the PDF on this device', async () => {
    const annotation = { id: 'a1', paperId: 'p1', type: 'highlight', pageNumber: 2, content: 'x', createdAt: '', updatedAt: '' };
    const loadSidecar = jest.fn(async () => ({ annotations: [annotation], reading: { page: 5, updatedAt: '2024-02-02T00:00:00Z' } }));
    const h = open(undefined, { loadSidecar } as unknown as Partial<ListPanelDeps>);
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.details', id: 'p1' });
    expect(h.last('details')).toEqual({
      type: 'details', id: 'p1',
      details: { annotations: [annotation], reading: { page: 5, updatedAt: '2024-02-02T00:00:00Z' }, pdf: { size: 2048, relPath: 'A/p1/paper.pdf' } },
    });
    await h.fire({ type: 'paper.details', id: 'p2' });
    expect(h.last('details')?.details.pdf).toBeNull();
  });

  it('answers similar papers without the paper itself, and an empty list when the AI index fails', async () => {
    const findSimilar = jest.fn(async () => [{ paperId: 'p1', score: 1 }, { paperId: 'p3', score: 0.8 }]);
    const h = open(undefined, { findSimilar } as unknown as Partial<ListPanelDeps>);
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.similar', id: 'p1' });
    expect(h.last('similar')).toEqual({ type: 'similar', id: 'p1', items: [{ paperId: 'p3', score: 0.8 }] });
    findSimilar.mockRejectedValueOnce(new Error('index down'));
    await h.fire({ type: 'paper.similar', id: 'p1' });
    expect(h.last('similar')?.items).toEqual([]);
  });

  it('tells the UI when a paper\'s sidecar changed', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    h.bus.annotationChanged.fire({ paperId: 'p1' });
    await flush();
    expect(h.last('sidecarChanged')).toEqual({ type: 'sidecarChanged', id: 'p1' });
  });

  it('tells the UI to ask for the shown details again when the projects citing papers change', async () => {
    const backlinks = new vscode.EventEmitter<void>();
    const h = open(undefined, { projectBacklinks: { index: () => new Map(), projectFolder: () => undefined, onDidChange: backlinks.event } });
    await h.fire({ type: 'ready' });
    backlinks.fire();
    await flush();
    expect(h.last('sidecarChanged')).toEqual({ type: 'sidecarChanged', id: null });
  });
});

describe('ListWebviewPanel — text layers', () => {
  function withJobs(initial: TextLayerJob[] = []) {
    let listener: (jobs: TextLayerJob[]) => void = () => undefined;
    const subscription = { dispose: jest.fn() };
    const textLayerJobs = {
      current: jest.fn(() => initial),
      onDidChange: jest.fn((l: (jobs: TextLayerJob[]) => void) => { listener = l; return subscription; }),
    };
    return { textLayerJobs, subscription, emit: (jobs: TextLayerJob[]) => listener(jobs) };
  }

  it('sends the running jobs after every snapshot, and each update as it comes', async () => {
    const jobs = withJobs([{ paperId: 'p1', phase: 'reading', page: 2, total: 9 }]);
    const h = open(undefined, { textLayerJobs: jobs.textLayerJobs } as Partial<ListPanelDeps>);
    jobs.emit([{ paperId: 'p1', phase: 'queued' }]);
    await flush();
    expect(h.posted()).toEqual([]);

    await h.fire({ type: 'ready' });
    expect(h.posted().map((m) => m.type)).toEqual(['navigate', 'snapshot', 'jobs']);
    expect(h.last('jobs')).toEqual({ type: 'jobs', jobs: [{ paperId: 'p1', phase: 'reading', page: 2, total: 9 }] });
    jobs.emit([]);
    await flush();
    expect(h.posted().at(-1)).toEqual({ type: 'jobs', jobs: [] });
  });

  it('stops listening to job updates when closed', () => {
    const jobs = withJobs();
    open(undefined, { textLayerJobs: jobs.textLayerJobs } as Partial<ListPanelDeps>);
    ListWebviewPanel.currentPanel?.dispose();
    expect(jobs.subscription.dispose).toHaveBeenCalled();
  });
});

describe('ListWebviewPanel — citation map', () => {
  const map = { papers: [{ id: 'p1', title: 'Title p1' }], links: [], missing: [] };
  const citationMap = () => ({ buildCitationMap: jest.fn(async () => map), importByDoi: jest.fn() });

  it('shows the map once the UI is ready when it was asked for before', async () => {
    const h = open(undefined, { citationMap: citationMap() } as Partial<ListPanelDeps>);
    ListWebviewPanel.showCitationMap(h.deps);
    await flush();
    expect(h.posted()).toEqual([]);

    await h.fire({ type: 'ready' });
    expect(h.posted().map((m) => m.type)).toEqual(['navigate', 'snapshot', 'citationMap.show', 'citationMap.show']);
    expect(h.last('citationMap.show')).toEqual({ type: 'citationMap.show', state: { status: 'ready', map } });
  });

  it('shows the map at once in a panel that is open and keeps its folder', async () => {
    const h = open(undefined, { citationMap: citationMap() } as Partial<ListPanelDeps>);
    await h.fire({ type: 'ready' });
    const before = h.posted().length;
    ListWebviewPanel.showCitationMap(h.deps);
    await flush();
    await flush();
    expect(h.posted().slice(before).map((m) => m.type)).toEqual(['citationMap.show', 'citationMap.show']);
  });

  it('opens a panel when none is open', async () => {
    const h = open(undefined, { citationMap: citationMap() } as Partial<ListPanelDeps>);
    ListWebviewPanel.currentPanel?.dispose();
    ListWebviewPanel.showCitationMap(h.deps);
    const created = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)?.value;
    created.webview._fireMessage({ type: 'ready' });
    await flush();
    await flush();
    expect((created.webview.postMessage as jest.Mock).mock.calls.map(([m]) => m.type)).toContain('citationMap.show');
  });
});

describe('ListWebviewPanel — reveal both ways', () => {
  it('holds a reveal until the UI is ready, then sends it once after the snapshot and without navigating', async () => {
    const h = open();
    h.created.webview.postMessage.mockClear();
    ListWebviewPanel.currentPanel?.dispose();
    const fresh = open();
    await ListWebviewPanel.revealPaper(fresh.deps, 'p2');
    await flush();
    expect(fresh.posted()).toEqual([]);

    await fresh.fire({ type: 'ready' });
    const types = fresh.posted().map((m) => m.type);
    expect(types.filter((t) => t === 'reveal')).toHaveLength(1);
    expect(types.indexOf('reveal')).toBeGreaterThan(types.indexOf('snapshot'));
    expect(fresh.last('reveal')).toEqual({ type: 'reveal', id: 'p2' });
  });

  it('creates a panel when none is open and posts reveal immediately in a ready one, without navigate', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    const before = h.posted().length;
    await ListWebviewPanel.revealPaper(h.deps, 'p1');
    await flush();
    const added = h.posted().slice(before);
    expect(added).toContainEqual({ type: 'reveal', id: 'p1' });
    expect(added.map((m) => m.type)).not.toContain('navigate');
    expect(ListWebviewPanel.currentPanel).toBeDefined();
  });

  it('holds a status scope until the UI is ready, then sends it after the snapshot', async () => {
    const h = open();
    await ListWebviewPanel.showScope(h.deps, 'unread');
    await flush();
    expect(h.posted()).toEqual([]);

    await h.fire({ type: 'ready' });
    const types = h.posted().map((m) => m.type);
    expect(types.indexOf('scope')).toBeGreaterThan(types.indexOf('snapshot'));
    expect(h.last('scope')).toEqual({ type: 'scope', status: 'unread' });
  });

  it('posts a status scope at once to a ready panel', async () => {
    const h = open();
    await h.fire({ type: 'ready' });
    await ListWebviewPanel.showScope(h.deps, 'done');
    await flush();
    expect(h.last('scope')).toEqual({ type: 'scope', status: 'done' });
  });

  it('drops a reveal queued before ready when the panel is disposed, and a fresh panel does not receive it', async () => {
    const h = open();
    await ListWebviewPanel.revealPaper(h.deps, 'p1');
    ListWebviewPanel.currentPanel?.dispose();
    h.created.webview._fireMessage({ type: 'ready' });
    await flush();
    expect(h.posted().map((m) => m.type)).not.toContain('reveal');

    const fresh = open();
    await fresh.fire({ type: 'ready' });
    expect(fresh.posted().map((m) => m.type)).not.toContain('reveal');
  });

  it('reports the selected paper to the host and ignores an empty selection', async () => {
    const onDidSelectPaper = jest.fn();
    const h = open(undefined, { onDidSelectPaper });
    await h.fire({ type: 'ready' });
    await h.fire({ type: 'paper.selected', id: 'p1' });
    expect(onDidSelectPaper).toHaveBeenCalledTimes(1);
    expect(onDidSelectPaper).toHaveBeenCalledWith('p1');
    await h.fire({ type: 'paper.selected', id: null });
    expect(onDidSelectPaper).toHaveBeenCalledTimes(1);
    expect(h.logger.log).not.toHaveBeenCalledWith('WARN', expect.anything(), 'List webview sent a message this host does not offer', expect.anything());
  });
});
