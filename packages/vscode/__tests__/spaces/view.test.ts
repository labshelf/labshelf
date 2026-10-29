// Tests the Spaces view: panels, host service and checklist progress.
import * as vscode from 'vscode';
import { readChecklistSignals, SpaceStore, type ILogger, type ProjectLibraryPort } from '@labshelf/core';
import type { LibraryRootController } from '../../src/activation/index.js';
import type { ActiveServices } from '../../src/command/index.js';
import { readProjectChecklist, registerSpacesPanels, SpacesService } from '../../src/spaces/view';

jest.mock('@labshelf/core', () => ({
  ...jest.requireActual('@labshelf/core'), serveSpaces: jest.fn(() => jest.fn()), readChecklistSignals: jest.fn(),
}));

describe('panels.test', () => {
  // Verifies Space panel identity, lifecycle and bundle failures.
  jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), serveSpaces: jest.fn(() => jest.fn()) }));
  const flush = () => new Promise(resolve => setImmediate(resolve));

  function setup() {
    const change = new vscode.EventEmitter<void>();
    let notify = () => {};
    let rows = [{ state: "ready", space: { id: "alpha", name: "Alpha" } }, { state: "ready", space: { id: "beta", name: "Beta" } }];
    const current = { store: { list: () => rows, onChange: (fn: () => void) => { notify = fn; return () => {}; } }, port: {}, logger: { log: jest.fn() } };
    let root: typeof current | undefined = current;
    const context = { extensionUri: vscode.Uri.file("/ext"), subscriptions: [] as vscode.Disposable[] } as vscode.ExtensionContext;
    const source = registerSpacesPanels(context, { current: () => root, onDidChange: change.event } as unknown as SpacesService);
    const command = (id: string, ...args: unknown[]) => (vscode.commands.registerCommand as jest.Mock).mock.calls.find(([name]) => name === id)![1](...args);
    return { source, current, command, broadcast: () => change.fire(), rename: () => { rows[0]!.space.name = "Renamed"; notify(); }, remove: () => { rows = rows.slice(1); notify(); }, rootChange: () => { root = undefined; change.fire(); } };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({});
  });

  test("opens a singleton catalog and one panel per Space, revealing repeated opens", () => {
    const h = setup();
    h.command("labshelf.spaces.all"); h.command("labshelf.spaces.all");
    h.command("labshelf.spaces.open", "alpha"); h.command("labshelf.spaces.open", "alpha"); h.command("labshelf.spaces.open", "beta");
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(3);
    const panels = (vscode.window.createWebviewPanel as jest.Mock).mock.results.map(result => result.value);
    expect(panels.map(panel => panel.title)).toEqual(["All Spaces", "Alpha", "Beta"]);
    expect(panels[0].reveal).toHaveBeenCalledTimes(1);
    expect(panels[1].reveal).toHaveBeenCalledTimes(1);
    h.source.dispose();
  });

  test("shows the bundle-missing page when the Spaces bundle is absent", async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error("missing"));
    const h = setup(); h.command("labshelf.spaces.all"); await flush();
    const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
    expect(panel.webview.html).toContain("Spaces bundle not built");
    expect(panel.webview.html).toContain("dist/spaces/spaces.js");
    h.source.dispose();
  });

  test("refreshes titles and chat context, closes deleted Spaces and closes panels on root changes", () => {
    const h = setup(); h.command("labshelf.spaces.open", "alpha");
    const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
    expect(h.source.context()).toBe("Alpha");
    h.rename(); expect(panel.title).toBe("Renamed"); expect(h.source.context()).toBe("Renamed");
    panel._fireViewState({ active: false }); expect(h.source.context()).toBeNull();
    panel._fireViewState({ active: true }); expect(h.source.context()).toBe("Renamed");
    h.remove(); expect(panel.dispose).toHaveBeenCalled(); expect(h.source.context()).toBeNull();
    h.command("labshelf.spaces.all"); h.rootChange();
    expect((vscode.window.createWebviewPanel as jest.Mock).mock.results[1]!.value.dispose).toHaveBeenCalled();
    h.source.dispose();
  });

  test("keeps panels open when the active services broadcast a data change", () => {
    const h = setup(); h.command("labshelf.spaces.open", "alpha");
    const panel = (vscode.window.createWebviewPanel as jest.Mock).mock.results[0]!.value;
    h.broadcast(); expect(panel.dispose).not.toHaveBeenCalled();
    h.command("labshelf.spaces.open", "alpha", "papers");
    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: "spaces.navigate", tab: "papers" });
    h.source.dispose();
  });
});

describe('registerSpaces.test', () => {
  // Verifies Spaces use project checklist signals and reading statuses for progress.
  jest.mock("@labshelf/core", () => ({ ...jest.requireActual("@labshelf/core"), readChecklistSignals: jest.fn() }));

  it("counts source issues, manual items and resolved reading entries", async () => {
    jest.mocked(readChecklistSignals).mockResolvedValue({ sources: [], todos: [{ file: "main.tex", line: 1, text: "Fix" }], brokenRefs: [], staleFigures: [],
      manual: [{ id: "m", text: "Check", done: true, createdAt: "2026-10-21" }], noteTasks: [], noteTitles: new Map() });
    const writing = { projects: { list: () => [{ kind: "ready", folder: "/project", settings: {} }], reads: jest.fn() },
      readingLists: { of: async () => ({ entries: [{ key: "p", paper: { title: "Paper", status: "done" } }, { key: "missing" }] }) }, logger: {} };
    expect(await readProjectChecklist(writing as never, { id: "/project" } as never)).toEqual({ done: 2, total: 3 });
  });
});

describe('spacesService.test', () => {
  // Verifies the VS Code Spaces host lifecycle and export destination.
  const logger = { log: jest.fn(), error: jest.fn() } as unknown as ILogger;
  const paths = { join: (...parts: string[]) => parts.join('/') };

  function fixture(projectId = (id: string): string | undefined => id) {
    const rootChanges = new vscode.EventEmitter<never>();
    const services = { fileSystem: {}, logger, library: { snapshot: { papers: new Map() }, onChange: () => () => {} } } as unknown as ActiveServices;
    const controller = {
      currentRoot: () => vscode.Uri.file('/library'), currentServices: () => services,
      onDidChangeRoot: rootChanges.event, require: async () => services,
    } as unknown as LibraryRootController;
    const projectLibrary = { list: jest.fn(async () => []), onDidChange: () => () => {}, open: jest.fn() } as unknown as ProjectLibraryPort;
    const host = new SpacesService({ controller, paths, projectLibrary: () => projectLibrary, readChecklist: async () => undefined, projectId, logger, selectPaper: async () => {} });
    return { host, rootChanges, services, projectLibrary };
  }

  beforeEach(() => { jest.clearAllMocks(); jest.spyOn(SpaceStore.prototype, 'reload').mockResolvedValue([]); });
  afterEach(() => { jest.restoreAllMocks(); });

  test('saveFile writes exactly to the destination returned by the dialog and cancellation writes nothing', async () => {
    const { host } = fixture();
    const target = vscode.Uri.file('/exports/calendar.ics');
    jest.mocked(vscode.window.showSaveDialog).mockResolvedValueOnce(target).mockResolvedValueOnce(undefined);
    await host.current()!.port.saveFile('space.ics', 'calendar text');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledWith(target, new TextEncoder().encode('calendar text'));
    await host.current()!.port.saveFile('space.ics', 'cancelled');
    expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
    host.dispose();
  });

  test('watcher reloads on create, change and delete and is disposed across roots', async () => {
    const { host, rootChanges, services } = fixture();
    const watcher = jest.mocked(vscode.workspace.createFileSystemWatcher).mock.results.at(-1)!.value;
    const reload = jest.mocked(SpaceStore.prototype.reload);
    reload.mockClear();
    for (const event of ['create', 'change', 'delete']) watcher._fire(event, vscode.Uri.file('/library/spaces/a/space.json'));
    expect(reload).toHaveBeenCalledTimes(3);
    const initial = host.current()!.store;
    rootChanges.fire({ root: vscode.Uri.file('/other'), services } as never);
    expect(watcher.dispose).toHaveBeenCalled();
    expect(host.current()!.store).not.toBe(initial);
    host.dispose();
  });

  test('manifest declares Spaces commands and Research chat webview', () => {
    const manifest = require('../../package.json');
    expect(manifest.contributes.commands.map((entry: {command: string}) => entry.command)).toEqual(expect.arrayContaining([
      'labshelf.spaces.all', 'labshelf.spaces.open', 'labshelf.spaces.new', 'labshelf.researchChat.toggle',
    ]));
    expect(manifest.contributes.views.labshelfDetails).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'labshelf.researchChat', type: 'webview' }),
    ]));
  });

   test('projects expose persistent ids and open their corresponding host folder', async () => {
    const { host, projectLibrary } = fixture((id) => id === '/writing/project' ? 'project-uuid' : undefined);
    jest.mocked(projectLibrary.list).mockResolvedValue([{ id: '/writing/project', title: 'Draft', place: 'projects' }]);
    const port = host.current()!.port;
    expect((await port.projects())[0]?.projectId).toBe('project-uuid');
    await port.openProject('project-uuid');
    expect(projectLibrary.open).toHaveBeenCalledWith('/writing/project');
    host.dispose();
  });


  test('a library switch during the name prompt prevents a write to the previous library', async () => {
    const { host, rootChanges, services } = fixture();
    const create = jest.spyOn(SpaceStore.prototype, 'createSpace').mockResolvedValue('test');
    jest.mocked(vscode.window.showInputBox).mockImplementationOnce(async () => {
      rootChanges.fire({ root: vscode.Uri.file('/other'), services } as never);
      return 'Test';
    });
    await host.createSpace();
    expect(create).not.toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(expect.stringContaining('library changed'));
    host.dispose();
  });
});
