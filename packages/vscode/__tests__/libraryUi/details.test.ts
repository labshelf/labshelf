import * as vscode from 'vscode';
import { DetailsView, createSelectionSources } from '../../src/libraryUi/details';
import { createLibraryEvents } from '../../src/library/index';
import type { ListPanelDeps } from '../../src/libraryUi/listPanel';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function open(initialDeps: ListPanelDeps | null = { events: createLibraryEvents(), getPapersRoot: () => null } as unknown as ListPanelDeps) {
  let listDeps = initialDeps;
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  const port = { open: jest.fn(async () => {}), onDidChange: () => () => {} };
  const view = new DetailsView({
    extensionUri: vscode.Uri.file('/ext'), listDeps: () => listDeps, projectLibrary: () => port as never, logger: logger as never,
  });
  const panel = vscode.window.createWebviewPanel('test', 'Details', vscode.ViewColumn.One, {});
  const posted = (): unknown[] => (panel.webview.postMessage as jest.Mock).mock.calls.map(([m]) => m);
  const fire = async (msg: unknown): Promise<void> => { (panel.webview as never as { _fireMessage(m: unknown): void })._fireMessage(msg); await flush(); await flush(); };
  return { setListDeps: (deps: ListPanelDeps | null) => { listDeps = deps; }, view, panel, logger, port, posted, fire, resolve: () => view.resolveWebviewView(panel as unknown as vscode.WebviewView) };
}

beforeEach(() => {
  (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File, size: 1 });
});

describe('DetailsView', () => {
  it('closes the auxiliary sidebar when Details is visible', async () => {
    const h = open();
    await h.resolve();
    (h.panel as unknown as { visible: boolean }).visible = true;
    await h.view.toggle();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.closeAuxiliaryBar');
  });

  it('reveals Details when it is hidden', async () => {
    const h = open();
    const reveal = jest.spyOn(h.view, 'reveal').mockResolvedValue();
    await h.view.toggle();
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it('holds a target shown before ready, then sends it with the ready answer', async () => {
    const h = open();
    await h.resolve();
    h.view.show({ kind: 'paper', ids: ['p1'] });
    expect(h.posted()).toEqual([]);
    await h.fire({ channel: 'library', msg: { type: 'ready' } });
    expect(h.posted()).toEqual([{ type: 'details.show', target: { kind: 'paper', ids: ['p1'] } }]);
  });

  it('posts a target shown after ready at once', async () => {
    const h = open();
    await h.resolve();
    await h.fire({ channel: 'library', msg: { type: 'ready' } });
    h.view.show(null);
    expect(h.posted()).toEqual([{ type: 'details.show', target: null }]);
  });

  it('serves the projects channel from the port', async () => {
    const h = open();
    await h.resolve();
    await h.fire({ channel: 'projects', msg: { type: 'open', id: 'proj' } });
    expect(h.port.open).toHaveBeenCalledWith('proj');
  });

  it('forwards folder.open as an event without warning', async () => {
    const h = open();
    await h.resolve();
    const seen: string[] = [];
    h.view.onDidRequestFolder((folder) => seen.push(folder));
    await h.fire({ channel: 'library', msg: { type: 'folder.open', folder: 'papers/A' } });
    expect(seen).toEqual(['papers/A']);
    expect(h.logger.log).not.toHaveBeenCalled();
  });

  it('logs a WARN with channel and type for an invalid message', async () => {
    const h = open();
    await h.resolve();
    await h.fire({ channel: 'projects', msg: { type: 'bogus' } });
    expect(h.logger.log).toHaveBeenCalledWith('WARN', 'details.view', expect.any(String), { channel: 'projects', type: 'bogus' });
  });

  it('drops library messages with a WARN while no library is open', async () => {
    const h = open(null);
    await h.resolve();
    await h.fire({ channel: 'library', msg: { type: 'ready' } });
    expect(h.logger.log).toHaveBeenCalledWith('WARN', 'details.view', expect.stringContaining('no library'));
    expect(h.posted()).toEqual([]);
  });

  it('answers a ready that arrived without a library once the library is rebound', async () => {
    const h = open(null);
    await h.resolve();
    h.view.show({ kind: 'paper', ids: ['p1'] });
    await h.fire({ channel: 'library', msg: { type: 'ready' } });
    h.setListDeps({ events: createLibraryEvents(), getPapersRoot: () => '/lib/papers', pathOps: { sep: '/', join: (...p: string[]) => p.join('/') },
      paperService: { listPapers: async () => [] }, getSnapshot: () => ({ collections: new Map() }), logger: { log: async () => {} } } as unknown as ListPanelDeps);
    await h.view.rebindLibrary();
    await flush();
    expect(h.posted()).toContainEqual({ channel: 'library', msg: expect.objectContaining({ type: 'snapshot' }) });
    expect(h.posted()).toContainEqual({ type: 'details.show', target: { kind: 'paper', ids: ['p1'] } });
  });
});

describe('selectionSources', () => {
  function setup(hub: { publish: jest.Mock; activate: jest.Mock }) {
    const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
    return { logger, sources: createSelectionSources({ ...hub, current: () => null } as never, logger as never) };
  }

  describe('createSelectionSources', () => {
    it('publishes papers, projects and the reader paper, and clears on an empty selection', () => {
      const hub = { publish: jest.fn(), activate: jest.fn() };
      const { sources } = setup(hub);
      sources.listSelected(['a', 'b']);
      sources.listSelected([]);
      sources.projectSelected('proj');
      sources.projectSelected(null);
      sources.readerActivated('r');
      expect(hub.publish.mock.calls).toEqual([
        ['list', { kind: 'paper', ids: ['a', 'b'] }], ['list', null],
        ['projects', { kind: 'project', id: 'proj' }], ['projects', null],
        ['reader', { kind: 'paper', ids: ['r'] }],
      ]);
    });

    it('activates the list and projects sources', () => {
      const hub = { publish: jest.fn(), activate: jest.fn() };
      const { sources } = setup(hub);
      sources.listActivated();
      sources.projectsActivated();
      expect(hub.activate.mock.calls).toEqual([['list'], ['projects']]);
    });

    it('logs a hub failure instead of throwing', () => {
      const hub = { publish: jest.fn(() => { throw new Error('boom'); }), activate: jest.fn() };
      const { sources, logger } = setup(hub);
      expect(() => sources.listSelected(['a'])).not.toThrow();
      expect(logger.log).toHaveBeenCalledWith('ERROR', 'details.sources', 'Details selection failed', expect.objectContaining({ message: 'boom' }));
    });
  });
});
