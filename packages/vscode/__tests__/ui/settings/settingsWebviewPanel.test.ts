/**
 * The settings panel: one shell for the panel's life, state posted on ready and on every change, each action mapped
 * to its command, invalid messages logged, and status events heard even from a controller created after opening.
 */
import * as vscode from 'vscode';
import type { DriveStatus } from '@labshelf/core';
import { SettingsWebviewPanel, type SettingsPanelOptions } from '../../../src/ui/settings/index';

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const signedOut: DriveStatus = { connected: false, syncing: false, lastSyncTime: null, lastError: null };

function statusEvents() {
  const listeners = new Set<() => void>();
  return {
    event: ((listener: () => void) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; }) as vscode.Event<void>,
    fire: () => listeners.forEach((l) => l()),
    count: () => listeners.size,
  };
}

function open(extra: Partial<SettingsPanelOptions> = {}) {
  const events = statusEvents();
  const logger = { log: jest.fn(async () => {}), error: jest.fn(async () => {}) };
  let status: DriveStatus | null = null;
  const options: SettingsPanelOptions = {
    getLibraryRoot: () => vscode.Uri.file('/lib'),
    getDriveStatus: () => status,
    onDidChangeDriveStatus: events.event,
    reconfigureLibrary: jest.fn(async () => undefined),
    getLogger: () => logger,
    ...extra,
  };
  SettingsWebviewPanel.createOrShow(vscode.Uri.file('/ext'), options);
  const created = (vscode.window.createWebviewPanel as jest.Mock).mock.results.at(-1)?.value;
  const states = () => (created.webview.postMessage as jest.Mock).mock.calls.map(([m]) => m);
  return {
    options, events, logger, created, states,
    setStatus: (next: DriveStatus | null) => { status = next; },
    fire: async (msg: unknown) => { created.webview._fireMessage(msg); await flush(); },
  };
}

beforeEach(() => {
  SettingsWebviewPanel.currentPanel?.dispose();
  (vscode.window.createWebviewPanel as jest.Mock).mockClear();
  (vscode.commands.executeCommand as jest.Mock).mockClear();
});

describe('SettingsWebviewPanel', () => {
  it('sets the shell once and restricts resources to the settings bundle folder', async () => {
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValueOnce(new Error('FileNotFound'));
    const h = open();
    await flush();
    const html = h.created.webview.html;
    expect(html).toContain('Settings bundle not built');
    expect(h.created.options.localResourceRoots.map((u: vscode.Uri) => u.fsPath)).toEqual(['/ext/dist/settings']);
    await h.fire({ type: 'ready' });
    h.events.fire();
    expect(h.created.webview.html).toBe(html);
  });

  it('posts nothing before the page says ready, then the library root and the sync state', async () => {
    const h = open();
    await flush();
    expect(h.states()).toEqual([]);
    await h.fire({ type: 'ready' });
    expect(h.states()).toEqual([{ type: 'state', state: { libraryRoot: '/lib', sync: signedOut } }]);
  });

  it('reports no library as a null root', async () => {
    const h = open({ getLibraryRoot: () => null });
    await h.fire({ type: 'ready' });
    expect(h.states()[0].state.libraryRoot).toBeNull();
  });

  it('posts the state again on every status event, with the sync error', () => {
    const h = open();
    h.setStatus({ connected: true, syncing: false, lastSyncTime: '2024-03-04T14:05:00Z', lastError: 'Quota' });
    h.events.fire();
    expect(h.states()).toEqual([{ type: 'state', state: { libraryRoot: '/lib', sync: { connected: true, syncing: false, lastSyncTime: '2024-03-04T14:05:00Z', lastError: 'Quota' } } }]);
  });

  it('hears sync status that begins after the page opened, when the controller appears', () => {
    const h = open();
    expect(h.states()).toEqual([]);
    h.setStatus({ ...signedOut, connected: true });
    h.events.fire();
    expect(h.states().at(-1).state.sync.connected).toBe(true);
  });

  it.each([
    ['sync.connect', 'labshelf.sync.connect', []],
    ['sync.now', 'labshelf.sync.now', []],
    ['sync.disconnect', 'labshelf.sync.disconnect', []],
    ['settings.openNative', 'workbench.action.openSettings', ['labshelf']],
  ])('runs %s as the command %s and refreshes the page', async (action, command, args) => {
    const h = open();
    await h.fire({ type: 'action', action });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(command, ...args);
    expect(h.states()).toHaveLength(1);
  });

  it('runs the library wizard for library.reconfigure and refreshes the page', async () => {
    const h = open();
    await h.fire({ type: 'action', action: 'library.reconfigure' });
    expect(h.options.reconfigureLibrary).toHaveBeenCalledTimes(1);
    expect(h.states()).toHaveLength(1);
  });

  it('logs a message that is not valid and does nothing else', async () => {
    const h = open();
    await h.fire({ type: 'action', action: 'format.disk' });
    await h.fire({ command: 'sync.now' });
    expect(h.logger.log).toHaveBeenCalledTimes(2);
    expect(h.logger.log).toHaveBeenCalledWith('WARN', 'settings', 'Settings webview sent a message that is not valid', { type: 'action' });
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(h.states()).toEqual([]);
  });

  it('logs a failing action through the logger and still refreshes the page', async () => {
    const h = open();
    const boom = new Error('boom');
    (vscode.commands.executeCommand as jest.Mock).mockRejectedValueOnce(boom);
    await h.fire({ type: 'action', action: 'sync.now' });
    expect(h.logger.error).toHaveBeenCalledWith('settings', boom, { op: 'settings action' });
    expect(h.states()).toHaveLength(1);
  });

  it('reveals the open panel, refreshes it and creates no second one', () => {
    const h = open();
    SettingsWebviewPanel.createOrShow(vscode.Uri.file('/ext'), h.options);
    expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(h.created.reveal).toHaveBeenCalledWith(vscode.ViewColumn.One);
    expect(h.states()).toHaveLength(1);
  });

  it('stops listening and forgets the panel on dispose', () => {
    const h = open();
    expect(h.events.count()).toBe(1);
    h.created.dispose();
    expect(h.events.count()).toBe(0);
    expect(SettingsWebviewPanel.currentPanel).toBeUndefined();
  });

  it('warns on the console while no library (and so no logger) exists', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const h = open({ getLogger: () => undefined });
    await h.fire({ type: 'nope' });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
