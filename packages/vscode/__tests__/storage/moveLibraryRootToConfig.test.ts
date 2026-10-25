import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { ILogger } from '@labshelf/core';
import { readSharedLibraryRoot, resolveSharedConfigPath, updateSharedConfig } from '@labshelf/core/node';
import { moveLibraryRootToConfig } from '../../src/storage/index';
import { resolveLibraryRoot } from '../../src/storage/paths/index';
import { nodeSharedLibraryConfig as shared } from '../../src/storage/node/index';

const KEY = 'labshelf.libraryRoot';

function makeState(stored?: string): vscode.Memento & { update: jest.Mock } {
  const state = new Map<string, unknown>(stored ? [[KEY, stored]] : []);
  return {
    keys: () => [...state.keys()],
    get: (key: string) => state.get(key),
    update: jest.fn(async (key: string, value: unknown) => {
      if (value === undefined) { state.delete(key); } else { state.set(key, value); }
    }),
  } as unknown as vscode.Memento & { update: jest.Mock };
}

function makeLogger(): ILogger & { log: jest.Mock; error: jest.Mock } {
  return { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) };
}

afterEach(() => {
  fs.rmSync(resolveSharedConfigPath(), { force: true, recursive: true });
});

describe('moveLibraryRootToConfig', () => {
  it('opens the same library after the upgrade: copies a globalState-only root and clears globalState', async () => {
    const state = makeState('/Users/me/Library');
    const logger = makeLogger();
    const loggerFor = jest.fn(() => logger);

    await moveLibraryRootToConfig(state, shared, loggerFor);

    expect(await readSharedLibraryRoot()).toBe('/Users/me/Library');
    expect(state.get(KEY)).toBeUndefined();
    expect(loggerFor).toHaveBeenCalledWith('/Users/me/Library');
    expect(logger.log).toHaveBeenCalledWith('INFO', 'storage', expect.any(String), expect.objectContaining({ libraryRoot: '/Users/me/Library' }));
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    expect((await resolveLibraryRoot(shared))?.fsPath).toBe('/Users/me/Library');
  });

  it('keeps the shared config root when both exist and differ, and clears globalState', async () => {
    await updateSharedConfig({ libraryRoot: '/Users/me/FromTerminal', terminal: { sort: 'year' } });
    const state = makeState('/Users/me/FromVscode');
    const logger = makeLogger();

    await moveLibraryRootToConfig(state, shared, () => logger);

    expect(await readSharedLibraryRoot()).toBe('/Users/me/FromTerminal');
    expect(JSON.parse(fs.readFileSync(resolveSharedConfigPath(), 'utf8')).terminal).toEqual({ sort: 'year' });
    expect(state.get(KEY)).toBeUndefined();
    expect(logger.log).toHaveBeenCalledWith('WARN', 'storage', expect.any(String), expect.objectContaining({
      sharedRoot: '/Users/me/FromTerminal', globalStateRoot: '/Users/me/FromVscode',
    }));
  });

  it('keeps globalState when the shared config cannot be written, so the next start retries', async () => {
    // A directory in place of the file makes the atomic rename fail.
    fs.mkdirSync(resolveSharedConfigPath(), { recursive: true });
    const state = makeState('/Users/me/Library');
    const logger = makeLogger();

    await expect(moveLibraryRootToConfig(state, shared, () => logger)).resolves.toBe('/Users/me/Library');

    expect(state.get(KEY)).toBe('/Users/me/Library');
    expect(state.update).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith('storage', expect.anything(), expect.objectContaining({
      file: resolveSharedConfigPath(), globalStateRoot: '/Users/me/Library',
    }));
  });

  it('does nothing when neither store holds a root', async () => {
    const state = makeState();
    const loggerFor = jest.fn(makeLogger);

    await moveLibraryRootToConfig(state, shared, loggerFor);

    expect(fs.existsSync(resolveSharedConfigPath())).toBe(false);
    expect(state.update).not.toHaveBeenCalled();
    expect(loggerFor).not.toHaveBeenCalled();
  });
});
