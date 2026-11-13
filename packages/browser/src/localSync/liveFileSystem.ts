// The library file system as programmatic callers see it: text of a live file goes through its replica, everything else to the disk.
import type { LibraryFileSystem } from "@labshelf/core";
import type { LiveFiles } from "./liveFiles";

// CONTRACT: documents/contracts/local-sync.md#hosts
/** A `live` that rejects or resolves undefined leaves every call on `fs`. */
export function wrapLiveFileSystem(fs: LibraryFileSystem, live: () => Promise<LiveFiles | undefined>): LibraryFileSystem {
  const readLive = (): Promise<LiveFiles | undefined> => live().catch(() => undefined);
  return {
    listDir: (path) => fs.listDir(path),
    readFile: (path) => fs.readFile(path),
    writeFile: (path, content) => fs.writeFile(path, content),
    deleteFile: (path) => fs.deleteFile(path),
    stat: (path) => fs.stat(path),
    ensureDir: (path) => fs.ensureDir(path),
    exists: (path) => fs.exists(path),
    writeText: async (path, text) => {
      if (await (await readLive())?.write(path, text)) return;
      await fs.writeText(path, text);
    },
    readText: async (path) => (await (await readLive())?.read(path)) ?? fs.readText(path),
    rename: (from, to) => fs.rename(from, to),
    trash: (target) => fs.trash(target),
    removeTree: (target) => fs.removeTree(target),
    mkdir: (dir) => fs.mkdir(dir),
  };
}
