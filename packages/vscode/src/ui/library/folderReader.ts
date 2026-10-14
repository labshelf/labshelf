/** Reads the collection folders under papers/ through core's folder-level reader, as the nodes the tree and the list panel show. */
import * as path from 'node:path';
import type { ILogger } from '@labshelf/core';
import { createScanEnv, readFolderLevel, type ScanFileSystem } from '@labshelf/core';
import type { LibraryNode } from './libraryNode.js';

const LOG_MODULE = 'ui/library/folderReader';

/** Lists the collection folders directly inside a directory, sorted by name. */
export type FolderReader = (dirPath: string) => Promise<LibraryNode[]>;

/**
 * An unreadable directory yields an empty list and a warning, so one bad folder does not blank the tree.
 * @returns a reader over the given file system
 */
export function createFolderReader(fs: ScanFileSystem, logger: ILogger): FolderReader {
  const env = createScanEnv(fs, path, logger);
  return async (dirPath) => {
    try {
      const level = await readFolderLevel(env, dirPath);
      return level.collections.map((dir) => ({ label: path.basename(dir), dirPath: dir }));
    } catch (error) {
      await logger.log('WARN', LOG_MODULE, 'Folder could not be listed', {
        dirPath,
        message: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  };
}

/**
 * Lists every collection folder under `rootDir` at any depth, parents before children.
 * @returns a flat, depth-first list of collection folders
 */
export async function listAllCollectionFolders(read: FolderReader, rootDir: string): Promise<LibraryNode[]> {
  const all: LibraryNode[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const folder of await read(dir)) {
      all.push(folder);
      await walk(folder.dirPath);
    }
  };
  await walk(rootDir);
  return all;
}
