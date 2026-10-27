/** The Node adapters fill every host port with the process's own values, and the extension logger writes the rotating app.log. */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type * as vscode from 'vscode';
import { createDeviceLocalLayout } from '@labshelf/core/node';
import { createExtensionLogger, createNodeAdapters } from '../../../src/activation/node/desktopPlatform';

describe('createNodeAdapters', () => {
  const adapters = createNodeAdapters({ subscriptions: [] } as unknown as vscode.ExtensionContext);

  it('uses node:path for paths', () => {
    expect(adapters.paths.sep).toBe(path.sep);
    expect(adapters.paths.join('/a', 'b')).toBe(path.join('/a', 'b'));
  });

  it('shares the library root with the terminal app and reports the platform', () => {
    expect(adapters.sharedLibraryConfig.path()).toContain('labshelf');
    expect(adapters.reader.isMac).toBe(process.platform === 'darwin');
    expect(adapters.reader.locatePdfjs()).not.toBeNull();
  });

  it('places the device layout under the library\'s device-local folders', () => {
    const root = path.resolve('/tmp/labshelf-adapters-library');
    expect(adapters.deviceLayout(root)).toEqual(createDeviceLocalLayout(root));
  });
});

describe('createExtensionLogger', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'labshelf-logger-'));
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('keeps every entry of parallel log calls in the file', async () => {
    const file = path.join(dir, 'logs', 'app.log');
    const logger = createExtensionLogger(file);

    await Promise.all(Array.from({ length: 30 }, (_, i) => logger.log('INFO', 'test', `m${i}`)));

    const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l) as { message: string });
    expect(lines.map((e) => e.message)).toEqual(Array.from({ length: 30 }, (_, i) => `m${i}`));
  });

  it('appends to an existing log instead of rewriting it', async () => {
    const file = path.join(dir, 'app.log');
    await fs.writeFile(file, 'previous line\n');
    await createExtensionLogger(file).log('INFO', 'test', 'next');
    const text = await fs.readFile(file, 'utf8');
    expect(text.startsWith('previous line\n')).toBe(true);
    expect(text.trim().split('\n')).toHaveLength(2);
  });

  it('reports to the console and does not reject when the file cannot be written', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const blocker = path.join(dir, 'blocker');
    await fs.writeFile(blocker, '');
    const logger = createExtensionLogger(path.join(blocker, 'app.log'));

    await expect(logger.log('WARN', 'test', 'lost on disk')).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
