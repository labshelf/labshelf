import * as path from 'node:path';
import type { ILogger, LocalStat } from '@labshelf/core';
import { createFolderReader, listAllCollectionFolders } from '../../../src/ui/library/folderReader';

const ROOT = '/lib/papers';
const DIR: LocalStat = { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 };
const FILE: LocalStat = { isFile: true, isDirectory: false, mtimeMs: 0, size: 1 };

// papers/{Z, A/{B}, paper-folder/{metadata.yaml}, .hidden}
const TREE: Record<string, string[]> = {
  [ROOT]: ['Z', 'A', 'paper-folder', '.hidden'],
  [`${ROOT}/A`]: ['B'],
  [`${ROOT}/Z`]: [], [`${ROOT}/A/B`]: [],
  [`${ROOT}/paper-folder`]: ['metadata.yaml'],
};

function fakeFs(unreadable: string[] = []) {
  return {
    listDir: async (dir: string) => {
      if (unreadable.includes(dir)) { throw new Error('EACCES'); }
      return TREE[dir] ?? [];
    },
    stat: async (target: string) => (target in TREE ? DIR : target.endsWith('metadata.yaml') ? FILE : undefined),
    readText: async () => '',
  };
}

const logger = (): ILogger & { log: jest.Mock } => ({ log: jest.fn(async () => undefined), error: jest.fn(async () => undefined) });

describe('createFolderReader', () => {
  it('lists collection folders by name as tree nodes, skipping paper folders and dot folders', async () => {
    const read = createFolderReader(fakeFs(), path, logger());
    expect(await read(ROOT)).toEqual([{ label: 'A', dirPath: `${ROOT}/A` }, { label: 'Z', dirPath: `${ROOT}/Z` }]);
  });

  it('returns an empty list and logs a warning for a directory it cannot list', async () => {
    const log = logger();
    const read = createFolderReader(fakeFs([ROOT]), path, log);
    expect(await read(ROOT)).toEqual([]);
    expect(log.log).toHaveBeenCalledWith('WARN', expect.any(String), 'Folder could not be listed', expect.objectContaining({ dirPath: ROOT }));
  });
});

describe('listAllCollectionFolders', () => {
  it('walks every depth, parents before children', async () => {
    const all = await listAllCollectionFolders(createFolderReader(fakeFs(), path, logger()), ROOT);
    expect(all.map((f) => f.dirPath)).toEqual([`${ROOT}/A`, `${ROOT}/A/B`, `${ROOT}/Z`]);
  });
});
