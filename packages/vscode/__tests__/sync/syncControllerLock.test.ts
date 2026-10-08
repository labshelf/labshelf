import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

import { libraryLayout, type ILogger, type SyncTimerId, type SyncTimers } from '@labshelf/core';
import { FakeRemoteProvider } from '@labshelf/core/test-support/sync-fakes';

const provider = new FakeRemoteProvider();

// The real Drive auth needs the gitignored OAuth credentials and the keychain; a signed-in stand-in is enough here.
jest.mock('../../src/sync/auth/googleDriveAuth', () => ({
  GoogleDriveAuth: class {
    async loadPersistedState(): Promise<void> {}
    isAuthenticated(): boolean { return true; }
    async getAccessToken(): Promise<string> { return 'token'; }
    async authenticate(): Promise<void> {}
    async revoke(): Promise<void> {}
  },
}));

import { SyncController } from '../../src/sync/adapter/syncController';
import { reportSyncOutcome } from '../../src/sync/adapter/syncReport';
import { VscodeFileSystem } from '../../src/storage/vscodeFileSystem';
import { EventBus } from '../../src/events/index.js';

function context(): vscode.ExtensionContext {
  return { subscriptions: [], secrets: { get: async () => undefined } } as unknown as vscode.ExtensionContext;
}

const logs: Array<{ level: string; message: string }> = [];
const logger: ILogger = { log: async (level, _module, message) => { logs.push({ level, message }); }, error: async () => undefined };

function makeController(root: string, timers?: SyncTimers): SyncController {
  return new SyncController({
    ...(timers ? { timers } : {}),
    context: context(),
    paths: libraryLayout(vscode.Uri.file(root), vscode.Uri.joinPath),
    localFs: new VscodeFileSystem(path.join(root, '.research', 'tmp')),
    eventBus: new EventBus(),
    logger,
    listTitles: async () => [],
    createProvider: () => provider,
  });
}

function lockFile(root: string): string {
  return path.join(root, '.research', 'sync', 'google-drive.lock');
}

describe('SyncController and the cross-app sync lock', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-lock-'));
    fs.mkdirSync(path.join(root, '.research', 'sync'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function holdLockAsTerminal(): void {
    const now = new Date().toISOString();
    fs.writeFileSync(lockFile(root), JSON.stringify({
      app: 'terminal', pid: process.pid, host: os.hostname(), token: 'terminal-token', acquiredAt: now, heartbeatAt: now,
    }));
  }

  it('does not sync while the terminal app holds the lock, and says so on a manual sync', async () => {
    holdLockAsTerminal();
    const listSpy = jest.spyOn(provider, 'list');
    const controller = makeController(root);

    await controller.sync();

    expect(listSpy).not.toHaveBeenCalled();
    expect(vscode.window.setStatusBarMessage).toHaveBeenCalledWith(
      expect.stringContaining('terminal app is syncing'), expect.any(Number),
    );
    expect(JSON.parse(fs.readFileSync(lockFile(root), 'utf8')).token).toBe('terminal-token');
    expect(controller.isSyncing()).toBe(false);
    controller.dispose();
  });

  it('syncs against the new library after setLibrary, not the one it was built with', async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'labshelf-lock-other-'));
    fs.mkdirSync(path.join(other, '.research', 'sync'), { recursive: true });
    try {
      holdLockAsTerminal();
      const listSpy = jest.spyOn(provider, 'list');
      const controller = makeController(root);

      controller.setLibrary(libraryLayout(vscode.Uri.file(other), vscode.Uri.joinPath), new VscodeFileSystem(path.join(other, '.research', 'tmp')), logger);
      await controller.sync();

      expect(listSpy).toHaveBeenCalled();
      expect(JSON.parse(fs.readFileSync(lockFile(root), 'utf8')).token).toBe('terminal-token');
      controller.dispose();
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('logs a failed sync as an error and shows it', async () => {
    const controller = makeController(root);
    jest.spyOn(provider, 'resolveRoot').mockRejectedValueOnce(new Error('Drive is down'));
    await controller.sync();
    expect(logs).toContainEqual({ level: 'ERROR', message: 'Sync failed' });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('LabShelf Sync: Drive is down');
    controller.dispose();
  });

  it('syncs, records the run for the other apps and releases the lock', async () => {
    const controller = makeController(root);
    await controller.sync();

    expect(fs.existsSync(lockFile(root))).toBe(false);
    // Atomic write: the content goes to a temp file that is renamed to the record's path.
    const renamed = (vscode.workspace.fs.rename as jest.Mock).mock.calls
      .find(([, target]) => (target as vscode.Uri).fsPath.endsWith('google-drive.last.json'));
    const lastRun = (vscode.workspace.fs.writeFile as jest.Mock).mock.calls
      .find(([uri]) => (uri as vscode.Uri).fsPath === (renamed?.[0] as vscode.Uri | undefined)?.fsPath);
    expect(lastRun).toBeDefined();
    expect(JSON.parse(Buffer.from(lastRun![1] as Uint8Array).toString('utf8'))).toMatchObject({ app: 'vscode', providerId: 'fake' });
    controller.dispose();
  });

  it('takes over a lock left by a process that is gone', async () => {
    const stale = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(lockFile(root), JSON.stringify({
      app: 'terminal', pid: 999_999, host: 'another-host', token: 'old', acquiredAt: stale, heartbeatAt: stale,
    }));
    const listSpy = jest.spyOn(provider, 'list');
    const controller = makeController(root);
    await controller.sync();
    expect(listSpy).toHaveBeenCalled();
    expect(fs.existsSync(lockFile(root))).toBe(false);
    controller.dispose();
  });

  it('stays quiet when an automatic sync finds the lock taken or the user signed out', () => {
    const statusBar = { text: '' } as vscode.StatusBarItem;
    reportSyncOutcome(statusBar, { kind: 'busy', holder: undefined }, false);
    reportSyncOutcome(statusBar, { kind: 'skipped', reason: 'not signed in to Google Drive' }, false);
    expect(vscode.window.setStatusBarMessage).not.toHaveBeenCalled();
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('re-reads the interval setting on connect and on a change, and stops periodic syncs on disconnect', async () => {
    const armed = new Map<SyncTimerId, number>();
    const timers: SyncTimers = { start: (id, delayMs) => { armed.set(id, delayMs); }, cancel: (id) => { armed.delete(id); } };
    const workspace = vscode.workspace as unknown as { _config: Record<string, Record<string, unknown>>; _fireConfigChange(section: string): void };
    workspace._config['labshelf'] = { 'sync.autoSyncIntervalMinutes': 5 };
    const controller = makeController(root, timers);
    try {
      await controller.initialize();
      expect(armed.get('periodic')).toBe(5 * 60_000);

      workspace._config['labshelf'] = { 'sync.autoSyncIntervalMinutes': 7 };
      await controller.connect();
      expect(armed.get('periodic')).toBe(7 * 60_000);

      workspace._config['labshelf'] = { 'sync.autoSyncIntervalMinutes': 9 };
      workspace._fireConfigChange('labshelf.sync.autoSyncIntervalMinutes');
      expect(armed.get('periodic')).toBe(9 * 60_000);

      await controller.disconnect();
      expect(armed.has('periodic')).toBe(false);
    } finally {
      controller.dispose();
      delete workspace._config['labshelf'];
    }
  });
});
