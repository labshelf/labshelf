/** Pins that a VS Code window whose shared project folder another mirror holds waits without writing the folder. */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openFolderLease, type ILogger, type MirrorInput } from '@labshelf/core';
import { NodeLibraryFileSystem } from '@labshelf/core/node';
import { desktopMirrorFactory } from '../../../../src/collab/node/session/shareConnection';

const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

describe('desktopMirrorFactory', () => {
  let folder: string;
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), 'labshelf-mirror-'));
    await writeFile(join(folder, 'main.typ'), '= Hello\n');
  });
  afterEach(() => rm(folder, { recursive: true, force: true }));

  it('reports a folder another VS Code window holds as busy and leaves its files and lease alone', async () => {
    const first = await openFolderLease({ fs: new NodeLibraryFileSystem(), folder, app: 'vscode', logger });
    if (first.kind !== 'owned') { throw new Error('the first window did not take the lease'); }
    const leaseFile = join(folder, '.labshelf', 'mirror-lease.json');
    const lease = await readFile(leaseFile, 'utf8');
    const closed = new AbortController();

    const start = await desktopMirrorFactory(folder, logger, () => false)({
      folder, signal: closed.signal, onStopped: jest.fn(), session: {}, blobs: {}, store: {},
    } as unknown as MirrorInput);

    expect(start).toMatchObject({ kind: 'busy', holder: { app: 'vscode' } });
    closed.abort();
    await expect(start.kind === 'busy' ? start.running : undefined).resolves.toBeUndefined();
    expect(await readdir(folder)).toEqual(expect.arrayContaining(['main.typ', '.labshelf']));
    expect(await readFile(join(folder, 'main.typ'), 'utf8')).toBe('= Hello\n');
    expect(await readFile(leaseFile, 'utf8')).toBe(lease);
    await first.lease.release();
  });
});
