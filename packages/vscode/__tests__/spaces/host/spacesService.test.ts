// Verifies the VS Code Spaces host lifecycle and export destination.
import * as vscode from 'vscode';
import { SpaceStore, type ILogger, type ProjectLibraryPort } from '@labshelf/core';
import type { ActiveServices } from '../../../src/command/index.js';
import type { LibraryRootController } from '../../../src/activation/index.js';
import { SpacesService } from '../../../src/spaces/host/index.js';

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
  const manifest = require('../../../package.json');
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
