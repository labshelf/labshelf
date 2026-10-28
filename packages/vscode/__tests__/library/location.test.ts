/**
 * The library location: the root resolved from the shared config, the globalState root moved into it, and the reindex that
 * follows the scan with the right paper events and text-layer checks, without touching an unchanged library.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { LibraryStore } from '@labshelf/core';
import type { ILogger, LibraryScan, PaperRecord } from '@labshelf/core';
import { readSharedLibraryRoot, resolveSharedConfigPath, updateSharedConfig } from '@labshelf/core/node';
import { createLibraryEvents } from '../../src/library/events';
import { ensureLibraryStructure, moveLibraryRootToConfig, refreshLibrary, resolveLibraryRoot } from '../../src/library/location';
import { VscodeFileSystem } from '../../src/library/fileSystem';
import { nodeSharedLibraryConfig as shared } from '../../src/library/node/index';

function makeUri(fsPath: string): vscode.Uri {
  return vscode.Uri.file(fsPath);
}

const fsService = new VscodeFileSystem('/tmp/mylib', path, vscode.Uri.file);

beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(resolveSharedConfigPath(), { force: true, recursive: true });
});

// ─── resolveLibraryRoot ────────────────────────────────────────────────────────

describe('resolveLibraryRoot', () => {
  it('returns undefined when the shared config has no root', async () => {
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('returns undefined when the stored path is not a directory', async () => {
    await updateSharedConfig({ libraryRoot: '/tmp/some-path' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.File });
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('returns undefined when stat throws (path inaccessible)', async () => {
    await updateSharedConfig({ libraryRoot: '/tmp/nonexistent' });
    (vscode.workspace.fs.stat as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    expect(await resolveLibraryRoot(shared)).toBeUndefined();
  });

  it('opens the root any app recorded in the shared config', async () => {
    await updateSharedConfig({ libraryRoot: '/Users/me/FromTerminal' });
    (vscode.workspace.fs.stat as jest.Mock).mockResolvedValue({ type: vscode.FileType.Directory });
    expect((await resolveLibraryRoot(shared))?.fsPath).toBe('/Users/me/FromTerminal');
  });
});

// ─── ensureLibraryStructure ───────────────────────────────────────────────────

describe('ensureLibraryStructure', () => {
  it('creates .research/, .research/papers/ and papers/ directories', async () => {
    (vscode.workspace.fs.createDirectory as jest.Mock).mockResolvedValue(undefined);
    const root = makeUri('/tmp/mylib');

    await ensureLibraryStructure(root, fsService);

    const created = (vscode.workspace.fs.createDirectory as jest.Mock).mock.calls.map(
      ([uri]: [vscode.Uri]) => uri.fsPath,
    );
    expect(created.some(p => p.endsWith('.research'))).toBe(true);
    expect(created.some(p => p.endsWith('logs'))).toBe(false);
    expect(created.some(p => p.endsWith('papers'))).toBe(true);
  });
});

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

const rec = (over: Partial<PaperRecord>): PaperRecord => ({
  id: 'p', title: 'P', path: '/lib/papers/p', citeKey: 'p', status: 'unread', ...over,
});

const scanOf = (records: PaperRecord[]): (() => Promise<LibraryScan>) => async () => ({
  papers: records.map((record) => ({ record, collection: '', modifiedMs: 0 })),
  folders: [], orphans: [], duplicates: [],
});

// A store whose scan reads from a mutable array, so a test can change what the "next" reload finds.
async function freshStore(seed: PaperRecord[] = []): Promise<{ store: LibraryStore; setNext: (records: PaperRecord[]) => void }> {
  let records = seed;
  const store = new LibraryStore({ root: '/lib/papers', scan: () => scanOf(records)() });
  await store.reload();
  return { store, setNext: (next) => { records = next; } };
}

function run(store: LibraryStore, setNext: (records: PaperRecord[]) => void, next: PaperRecord[]) {
  setNext(next);
  const events = createLibraryEvents();
  const emit = jest.fn();
  events.paperAdded.event((paper) => emit('paper:added', paper));
  events.paperUpdated.event((paper) => emit('paper:updated', paper));
  events.paperDeleted.event((paper) => emit('paper:deleted', paper));
  const queueCheck = jest.fn();
  const summary = refreshLibrary({ store, events, queueCheck });
  return { summary, emit, queueCheck };
}

describe('refreshLibrary', () => {
  it('emits paper:updated and queues a check when a PDF appears', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'a', hasPdf: false })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'a', hasPdf: true })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', hasPdf: true }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['a']);
  });

  it('emits paper:added for a new folder, stores it and queues its check', async () => {
    const { store, setNext } = await freshStore();
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'new', hasPdf: true })]);

    expect(await summary).toEqual({ added: ['new'], updated: [], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:added', expect.objectContaining({ id: 'new' }));
    expect(queueCheck.mock.calls[0][0].map((p: PaperRecord) => p.id)).toEqual(['new']);
    expect([...store.snapshot.papers.keys()]).toEqual(['new']);
  });

  it('deletes a paper missing from the scan and emits paper:deleted', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'gone' }), rec({ id: 'kept', path: '/lib/papers/kept' })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'kept', path: '/lib/papers/kept' })]);

    expect(await summary).toEqual({ added: [], updated: [], removed: ['gone'] });
    expect(emit).toHaveBeenCalledWith('paper:deleted', { id: 'gone' });
    expect([...store.snapshot.papers.keys()]).toEqual(['kept']);
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does nothing, with no events and no check, for an unchanged library', async () => {
    const seed = [rec({ id: 'a', hasPdf: true, textLayer: { state: 'native', checkedAt: 'x' } })];
    const { store, setNext } = await freshStore(seed);
    const { summary, emit, queueCheck } = run(store, setNext, seed);

    expect(await summary).toEqual({ added: [], updated: [], removed: [] });
    expect(emit).not.toHaveBeenCalled();
    expect(queueCheck).not.toHaveBeenCalled();
  });

  it('does not re-check an updated paper that already had its PDF', async () => {
    const { store, setNext } = await freshStore([rec({ id: 'a', hasPdf: true, title: 'Old' })]);
    const { summary, emit, queueCheck } = run(store, setNext, [rec({ id: 'a', hasPdf: true, title: 'New' })]);

    expect(await summary).toEqual({ added: [], updated: ['a'], removed: [] });
    expect(emit).toHaveBeenCalledWith('paper:updated', expect.objectContaining({ id: 'a', title: 'New' }));
    expect(queueCheck).not.toHaveBeenCalled();
  });
});
