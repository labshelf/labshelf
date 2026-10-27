// Pins the desktop collab session: mirror wakeups for conflict dismissals and the busy folder lease.
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { openFolderLease, type ILogger, type MirrorFileSystem, type MirrorInput } from '@labshelf/core';
import { NodeLibraryFileSystem } from '@labshelf/core/node';
import { createDesktopMirrorFactory, watchConflictDismissals } from '../../../src/collab/node/session';

describe('dismissalWatch', () => {
  it('retries held paths after an atomic dismissal write and closes both watchers', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'labshelf-dismissal-'));
    const file = path.join(folder, 'conflict-dismissals.json');
    const stopProject = jest.fn();
    const disk: MirrorFileSystem = {
      read: async () => ({ state: 'missing' }), write: async () => {}, remove: async () => {}, list: async () => [],
      watch: () => stopProject,
    };
    const logger: ILogger = { log: jest.fn(), error: jest.fn() };
    const wrapped = watchConflictDismissals(disk, file, new Set(['main (1).tex']), logger);
    let stop: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const retried = new Promise<string>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Mirror did not retry the dismissed copy')), 3000);
        stop = wrapped.watch!(resolve);
      });
      await fs.writeFile(`${file}.tmp`, '[]');
      await fs.rename(`${file}.tmp`, file);
      await expect(retried).resolves.toBe('main (1).tex');
      stop!();
      stop = undefined;
      expect(stopProject).toHaveBeenCalledTimes(1);
      expect(logger.error).not.toHaveBeenCalled();
    } finally {
      if (timer) clearTimeout(timer);
      stop?.();
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

describe('createDesktopMirrorFactory', () => {
  const logger = { log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) } as unknown as ILogger;

  describe('createDesktopMirrorFactory', () => {
    let folder: string;
    beforeEach(async () => {
      folder = await mkdtemp(path.join(os.tmpdir(), 'labshelf-mirror-'));
      await writeFile(path.join(folder, 'main.typ'), '= Hello\n');
    });
    afterEach(() => rm(folder, { recursive: true, force: true }));

    it('reports a folder another VS Code window holds as busy and leaves its files and lease alone', async () => {
      const first = await openFolderLease({ fs: new NodeLibraryFileSystem(), folder, app: 'vscode', logger });
      if (first.kind !== 'owned') { throw new Error('the first window did not take the lease'); }
      const leaseFile = path.join(folder, '.labshelf', 'mirror-lease.json');
      const lease = await readFile(leaseFile, 'utf8');
      const closed = new AbortController();

      const start = await createDesktopMirrorFactory(folder, logger, () => false)({
        folder, signal: closed.signal, onStopped: jest.fn(), session: {}, blobs: {}, store: {},
      } as unknown as MirrorInput);

      expect(start).toMatchObject({ kind: 'busy', holder: { app: 'vscode' } });
      closed.abort();
      await expect(start.kind === 'busy' ? start.running : undefined).resolves.toBeUndefined();
      expect(await readdir(folder)).toEqual(expect.arrayContaining(['main.typ', '.labshelf']));
      expect(await readFile(path.join(folder, 'main.typ'), 'utf8')).toBe('= Hello\n');
      expect(await readFile(leaseFile, 'utf8')).toBe(lease);
      await first.lease.release();
    });
  });
});
