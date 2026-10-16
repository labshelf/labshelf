import * as path from 'node:path';
import * as vscode from 'vscode';
import { snapshotFromScan, type LibrarySnapshot, type PaperEntry, type PaperRecord } from '@labshelf/core';
import { createLibraryEvents, type LibraryEvents } from '../../src/events/index';
import type { ContinueSource, ContinueTarget } from '../../src/continue/index';
import { LibraryDragAndDropController } from '../../src/ui/library/libraryDragAndDrop';
import type { LibraryTreeNode } from '../../src/ui/library/libraryNode';
import { LibraryTreeDataProvider } from '../../src/ui/library/libraryTreeDataProvider';

const ROOT = '/lib/papers';
const TREE_MIME = 'application/vnd.code.tree.labshelf.library';

const EXT = '/ext';
// papers/{A/{B}, Z}: "Beta" (unread) and "Alpha" (done) in A, "Deep" (reading) in A/B, one paper directly in papers/. Z holds no paper.
// The paper with id "Z" lives in A: its id equals a folder name.
function snapshotOf(folders: string[]): LibrarySnapshot {
  const entry = (id: string, collection: string, title: string, status: PaperRecord['status']): PaperEntry => ({
    record: { id, title, status, path: ['papers', collection, id].filter(Boolean).join('/') } as PaperRecord, collection, modifiedMs: 0,
  });
  const papers = [entry('p1', 'A', 'Beta', 'unread'), entry('Z', 'A', 'Alpha', 'done'), entry('p2', 'A/B', 'Deep', 'reading'), entry('loose-paper', '', 'Loose', 'reading')];
  return snapshotFromScan(ROOT, { folders, papers, orphans: [], duplicates: [] }, 0);
}
let snapshot: LibrarySnapshot | undefined;
const folderA = { label: 'A', dirPath: `${ROOT}/A` };
const folderB = { label: 'B', dirPath: `${ROOT}/A/B` };

let targets: ContinueTarget[] = [];
let continueChanged: vscode.EventEmitter<void>;
const continueSource = (): ContinueSource => {
  continueChanged = new vscode.EventEmitter<void>();
  return { targets: async () => targets, onDidChange: continueChanged.event };
};

function makeProvider(): { provider: LibraryTreeDataProvider; bus: LibraryEvents } {
  const bus = createLibraryEvents();
  snapshot = snapshotOf(['A', 'A/B', 'Z']);
  targets = [];
  const provider = new LibraryTreeDataProvider(vscode.Uri.file(ROOT), () => snapshot, bus, path, continueSource(), vscode.Uri.file(EXT));
  return { provider, bus };
}

async function itemsOf(provider: LibraryTreeDataProvider, node?: LibraryTreeNode): Promise<vscode.TreeItem[]> {
  return Promise.all((await provider.getChildren(node)).map((n) => provider.getTreeItem(n)));
}
const labelsOf = async (provider: LibraryTreeDataProvider, node?: LibraryTreeNode): Promise<string[]> => (await itemsOf(provider, node)).map((i) => String(i.label));
const SCOPE_LABELS = ['All papers', 'Unread', 'Reading', 'Done'];

describe('LibraryTreeDataProvider', () => {
  it('lists the four scope rows, then the top-level folders, then the papers directly in papers/', async () => {
    const { provider } = makeProvider();
    expect(await labelsOf(provider)).toEqual([...SCOPE_LABELS, 'A', 'Z', 'Loose']);
    const top = await provider.getChildren();
    expect(await provider.getChildren(top[0])).toEqual([]);
  });

  it('shows each scope count as the row description, equal to the core tree scopes', async () => {
    const { provider } = makeProvider();
    const items = (await itemsOf(provider)).slice(0, 4);
    expect(items.map((i) => i.description)).toEqual(['4', '1', '2', '1']);
    expect(items.every((i) => i.collapsibleState === vscode.TreeItemCollapsibleState.None)).toBe(true);
  });

  it('gives Unread, Reading and Done their arc mark icon and opens the list on the scope when clicked', async () => {
    const { provider } = makeProvider();
    const items = (await itemsOf(provider)).slice(0, 4);
    const marks: Array<[string, string]> = [['accent-none', 'unread'], ['accent-half', 'reading'], ['ok-full', 'done']];
    marks.forEach(([mark, scope], i) => {
      const item = items[i + 1]!;
      const icon = item.iconPath as { light: vscode.Uri; dark: vscode.Uri };
      expect(icon.light.fsPath).toBe(`${EXT}/out/marks/${mark}-light.svg`);
      expect(icon.dark.fsPath).toBe(`${EXT}/out/marks/${mark}-dark.svg`);
      expect(item.command).toMatchObject({ command: 'labshelf.openListScope', arguments: [scope] });
    });
    expect(items[0]!.command).toMatchObject({ command: 'labshelf.openListScope', arguments: ['all'] });
  });

  it('lists a folder\'s subfolders first, then its papers by title', async () => {
    const { provider } = makeProvider();
    const items = await itemsOf(provider, folderA);
    expect(items.map((i) => i.label)).toEqual(['B', 'Alpha', 'Beta']);
    expect(items[0]).toMatchObject({ description: '1', collapsibleState: vscode.TreeItemCollapsibleState.Collapsed });
    expect(await labelsOf(provider, folderB)).toEqual(['Deep']);
  });

  it('shapes a paper row: title, not collapsible, ref icon, paper context and a reveal command', async () => {
    const { provider } = makeProvider();
    const [, alpha, beta] = await itemsOf(provider, folderA);
    for (const [item, id] of [[beta!, 'p1'], [alpha!, 'Z']] as const) {
      expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
      expect(item.contextValue).toBe('paper');
      const icon = item.iconPath as { light: vscode.Uri; dark: vscode.Uri };
      expect(icon.light.fsPath).toBe(`${EXT}/out/marks/ref-light.svg`);
      expect(icon.dark.fsPath).toBe(`${EXT}/out/marks/ref-dark.svg`);
      expect(item.command).toMatchObject({ command: 'labshelf.revealPaper', arguments: [id] });
    }
  });

  it('never gives a paper the TreeItem id of a folder, even when the paper id equals a folder name', async () => {
    const { provider } = makeProvider();
    const items = [...(await itemsOf(provider)).slice(4), ...(await itemsOf(provider, folderA)), ...(await itemsOf(provider, folderB))];
    expect(items).toHaveLength(7);
    const ids = items.map((i) => i.id);
    expect(ids.every((id) => typeof id === 'string')).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not compute nested folders: the top level holds only its own papers, a folder only its own', async () => {
    const { provider } = makeProvider();
    const top = await labelsOf(provider);
    expect(top).toHaveLength(7);
    expect(top).not.toEqual(expect.arrayContaining(['Alpha']));
    expect(top).not.toEqual(expect.arrayContaining(['Deep']));
    expect(await labelsOf(provider, folderA)).not.toContain('Deep');
  });

  it('returns nothing while no library is configured', async () => {
    const provider = new LibraryTreeDataProvider(null, () => undefined, createLibraryEvents(), path, continueSource(), vscode.Uri.file(EXT));
    expect(await provider.getChildren()).toEqual([]);
  });

  it('lists the folders of the snapshot it reads at request time, empty ones included', async () => {
    const { provider } = makeProvider();
    expect(await labelsOf(provider)).toEqual([...SCOPE_LABELS, 'A', 'Z', 'Loose']);
    expect((await provider.getChildren(folderA))[0]).toEqual(folderB);

    snapshot = snapshotOf(['A', 'A/B', 'Z', 'New']);
    expect(await labelsOf(provider)).toEqual([...SCOPE_LABELS, 'A', 'New', 'Z', 'Loose']);
  });

  it('opens every folder in the list panel, including ones with subfolders', async () => {
    const { provider } = makeProvider();
    const parent = { label: 'A', dirPath: `${ROOT}/A` };
    const item = await provider.getTreeItem(parent);

    expect(item.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(item.command).toEqual({ command: 'labshelf.openListTab', title: 'Open', arguments: [parent] });
    expect(item.contextValue).toBe('labshelfFolder');
  });

  it('shows recursive paper counts and omits them for empty folders', async () => {
    const { provider } = makeProvider();
    expect((await provider.getTreeItem(folderA)).description).toBe('3');
    expect((await provider.getTreeItem({ label: 'Z', dirPath: `${ROOT}/Z` })).description).toBeUndefined();
  });

  it('resolves parents for reveal and stops at the top level', () => {
    const { provider } = makeProvider();
    expect(provider.getParent(folderB)).toEqual(folderA);
    expect(provider.getParent(folderA)).toBeNull();
  });

  it('resolves the parent of a paper row to its folder', async () => {
    const { provider } = makeProvider();
    const [, alpha] = await provider.getChildren(folderA);
    expect(provider.getParent(alpha!)).toEqual(folderA);
    const [deep] = await provider.getChildren(folderB);
    expect(provider.getParent(deep!)).toEqual(folderB);
  });

  it('finds the node of a paper by id, with its real title, and nothing for an unknown id', () => {
    const { provider } = makeProvider();
    expect(provider.paperNode('p2')).toEqual({ paperId: 'p2', title: 'Deep' });
    expect(provider.paperNode('Z')).toEqual({ paperId: 'Z', title: 'Alpha' });
    expect(provider.paperNode('nope')).toBeUndefined();
  });

  it('keeps a paper directly in papers/ at the top level, so reveal finds it there', async () => {
    const { provider } = makeProvider();
    const loose = provider.paperNode('loose-paper')!;
    expect(await provider.getParent(loose)).toBeNull();
    expect(await provider.getChildren()).toContainEqual(loose);
  });

  it('coalesces a burst of paper events into one refresh', () => {
    jest.useFakeTimers();
    try {
      const { provider, bus } = makeProvider();
      const fired = jest.fn();
      provider.onDidChangeTreeData(fired);
      const paper = { id: 'p1' } as PaperRecord;

      bus.paperUpdated.fire(paper); bus.paperUpdated.fire(paper); bus.paperAdded.fire(paper);
      jest.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Continue rows', () => {
  const paper: ContinueTarget = { kind: 'paper', paperId: 'p1', title: 'Attention', page: 6 };
  const project: ContinueTarget = { kind: 'project', projectId: 'survey', file: '/proj/sec/a.tex', relativeFile: 'sec/a.tex', line: 41, character: 8 };

  it('puts the paper and the project file above the scope rows, and nothing when there is nothing to continue', async () => {
    const { provider } = makeProvider();
    expect(await labelsOf(provider)).toEqual([...SCOPE_LABELS, 'A', 'Z', 'Loose']);

    targets = [paper, project];
    const top = await provider.getChildren();
    expect(top).toHaveLength(9);
    const items = await Promise.all(top.slice(0, 2).map((n) => provider.getTreeItem(n)));
    expect(items.map((i) => [i.label, i.description])).toEqual([['Continue: Attention', 'page 6'], ['Continue: survey', 'sec/a.tex']]);
    expect(await provider.getChildren(top[0])).toEqual([]);
    expect(provider.getParent(top[0]!)).toBeNull();
  });

  it('opens the reader at the saved page and the file at the saved cursor', async () => {
    const { provider } = makeProvider();
    targets = [paper, project];
    const [paperRow, projectRow] = await provider.getChildren();
    expect((await provider.getTreeItem(paperRow!)).command).toEqual({ command: 'labshelf.openPdfViewer', title: 'Open', arguments: ['p1', 6] });
    const open = (await provider.getTreeItem(projectRow!)).command!;
    expect(open.command).toBe('vscode.open');
    const [uri, options] = open.arguments as [vscode.Uri, { selection: vscode.Range }];
    expect(uri.fsPath).toBe('/proj/sec/a.tex');
    expect(options.selection.start).toEqual({ line: 41, character: 8 });
  });

  it('refreshes when a project cursor is saved or a reader closes', () => {
    jest.useFakeTimers();
    try {
      const { provider, bus } = makeProvider();
      const fired = jest.fn();
      provider.onDidChangeTreeData(fired);
      continueChanged.fire();
      bus.pdfViewerClosed.fire({ paperId: 'p1' });
      jest.advanceTimersByTime(100);
      expect(fired).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('is not draggable and drops onto it target papers/', async () => {
    const onFolderMove = jest.fn(async () => {});
    const dnd = new LibraryDragAndDropController(jest.fn(), onFolderMove);
    const set = jest.fn();
    dnd.handleDrag([{ target: paper }], { set } as never);
    expect(set).not.toHaveBeenCalled();
    await dnd.handleDrop({ target: paper }, new (vscode as any).DataTransfer({ [TREE_MIME]: [`${ROOT}/Z`] }));
    expect(onFolderMove).toHaveBeenCalledWith([`${ROOT}/Z`], undefined);
  });
});

describe('LibraryDragAndDropController', () => {
  it('moves folders dragged inside the tree into the drop target', async () => {
    const onFileDrop = jest.fn(async () => {});
    const onFolderMove = jest.fn(async () => {});
    const dnd = new LibraryDragAndDropController(onFileDrop, onFolderMove);
    const transfer = new (vscode as any).DataTransfer({ [TREE_MIME]: [`${ROOT}/Z`] });

    await dnd.handleDrop({ label: 'A', dirPath: `${ROOT}/A` }, transfer);
    expect(onFolderMove).toHaveBeenCalledWith([`${ROOT}/Z`], `${ROOT}/A`);
    expect(onFileDrop).not.toHaveBeenCalled();
  });

  it('never drags the "All Papers" entry', () => {
    const dnd = new LibraryDragAndDropController(jest.fn(), jest.fn());
    const transfer = { set: jest.fn() };
    dnd.handleDrag([{ label: 'All Papers', dirPath: ROOT, isRoot: true }], transfer as never);
    expect(transfer.set).not.toHaveBeenCalled();
  });

  it('imports OS file drops, ignoring comments and non-file URIs', async () => {
    const onFileDrop = jest.fn(async () => {});
    const dnd = new LibraryDragAndDropController(onFileDrop, jest.fn());
    const transfer = new (vscode as any).DataTransfer({
      'text/uri-list': '# comment\nfile:///tmp/a.pdf\nhttps://example.com/b.pdf\n',
    });

    await dnd.handleDrop(undefined, transfer);
    expect(onFileDrop).toHaveBeenCalledTimes(1);
    const [uris, target] = onFileDrop.mock.calls[0] as unknown as [vscode.Uri[], string | undefined];
    expect(uris.map((u) => u.fsPath)).toEqual(['/tmp/a.pdf']);
    expect(target).toBeUndefined();
  });
});
