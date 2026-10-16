// Tests that a paper selected in the list panel while the Library view is hidden is selected in the tree once the view shows.
import * as vscode from 'vscode';
import { snapshotFromScan, type PaperEntry, type PaperRecord } from '@labshelf/core';

import { registerLibraryTreeView } from '../../../src/activation/registration/registerLibraryTreeView';
import { createLibraryEvents } from '../../../src/events/index';
import type { LibraryTreeViewDeps } from '../../../src/activation/registration/registerLibraryTreeView';

jest.mock('../../../src/continue/index', () => ({
  registerContinue: () => ({ targets: async () => [], onDidChange: () => ({ dispose: () => {} }) }),
}));

const ROOT = '/lib/papers';

function setup(log: jest.Mock = jest.fn(async () => {})): { view: { visible: boolean; reveal: jest.Mock }; visibility: vscode.EventEmitter<{ visible: boolean }>; revealPaperInTree: (id: string) => void } {
  const entry: PaperEntry = { record: { id: 'p1', title: 'Beta', status: 'unread', path: `${ROOT}/A/p1` } as PaperRecord, collection: 'A', modifiedMs: 0 };
  const snapshot = snapshotFromScan(ROOT, { folders: ['A'], papers: [entry], orphans: [], duplicates: [] }, 0);
  const visibility = new vscode.EventEmitter<{ visible: boolean }>();
  const view = { visible: false, reveal: jest.fn(async () => undefined), onDidChangeVisibility: visibility.event, dispose: () => {} };
  (vscode.window.createTreeView as jest.Mock).mockReturnValueOnce(view);
  const controller = {
    currentServices: () => ({ library: { snapshot }, logger: { log } }),
    currentRoot: () => vscode.Uri.file('/lib'),
    onDidChangeRoot: new vscode.EventEmitter<{ root: vscode.Uri }>().event,
  };
  const handles = registerLibraryTreeView({
    context: { subscriptions: [], extensionUri: vscode.Uri.file('/ext') },
    events: createLibraryEvents(),
    controller,
    papersRootUri: () => vscode.Uri.file(ROOT),
    folderHost: {},
    adapters: { paths: require('node:path') },
    projects: { onDidChange: () => ({ dispose: () => {} }) },
  } as unknown as LibraryTreeViewDeps);
  return { view, visibility, revealPaperInTree: handles.revealPaperInTree };
}

describe('registerLibraryTreeView revealPaperInTree', () => {
  it('selects a paper chosen while the Library view was hidden once the view becomes visible', () => {
    const { view, visibility, revealPaperInTree } = setup();

    revealPaperInTree('p1');
    view.visible = true;
    visibility.fire({ visible: true });

    expect(view.reveal).toHaveBeenCalledWith({ paperId: 'p1', title: 'Beta' }, { select: true, focus: false, expand: true });
  });

  it('reveals a paper immediately when the Library view is visible', () => {
    const { view, revealPaperInTree } = setup();
    view.visible = true;

    revealPaperInTree('p1');

    expect(view.reveal).toHaveBeenCalledWith({ paperId: 'p1', title: 'Beta' }, { select: true, focus: false, expand: true });
  });

  it('selects only the latest paper chosen while the view was hidden', () => {
    const { view, visibility, revealPaperInTree } = setup();

    revealPaperInTree('missing');
    revealPaperInTree('p1');
    view.visible = true;
    visibility.fire({ visible: true });

    expect(view.reveal).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when the selected paper has no row in the tree', () => {
    const log = jest.fn(async () => {});
    const { view, revealPaperInTree } = setup(log);
    view.visible = true;

    revealPaperInTree('missing');

    expect(view.reveal).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('WARN', 'ui/library', 'Selected paper has no row in the Library tree', { paperId: 'missing' });
  });
});
