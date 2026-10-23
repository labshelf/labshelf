// Pins mirror wakeups for conflict dismissals written outside the project.
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ILogger, MirrorDisk } from '@labshelf/core';
import { watchConflictDismissals } from '../../../../../src/collab/node/session/conflicts/index';

it('retries held paths after an atomic dismissal write and closes both watchers', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'labshelf-dismissal-'));
  const file = path.join(folder, 'conflict-dismissals.json');
  const stopProject = jest.fn();
  const disk: MirrorDisk = {
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
