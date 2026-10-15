/** The Node adapters fill every host port with the process's own values. */
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { createNodeAdapters } from '../../../src/activation/node/index';

describe('createNodeAdapters', () => {
  const adapters = createNodeAdapters({ subscriptions: [], secrets: {} } as unknown as vscode.ExtensionContext);

  it('uses node:path for paths and the process identity for the sync lock', () => {
    expect(adapters.paths.sep).toBe(path.sep);
    expect(adapters.paths.join('/a', 'b')).toBe(path.join('/a', 'b'));
    expect(adapters.sync.host).toEqual({ name: os.hostname(), pid: process.pid });
    expect(adapters.sync.lock.isProcessAlive(process.pid)).toBe(true);
  });

  it('shares the library root with the terminal app and reports the platform', () => {
    expect(adapters.sharedLibraryConfig.path()).toContain('labshelf');
    expect(adapters.reader.isMac).toBe(process.platform === 'darwin');
    expect(adapters.reader.locatePdfjs()).not.toBeNull();
  });
});
