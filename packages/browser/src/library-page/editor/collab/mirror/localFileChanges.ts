// Tells this page's running share mirrors which library files the page itself wrote, so a shared project picks them up at once.
// TRAP: browser storage has no watcher and a folder is rescanned only every 30 s, so a page write reaches the share only through this.
import type { LibraryFileSystem } from "@labshelf/core";

type Listener = (paths: readonly string[]) => void;

const listeners = new Set<Listener>();

function report(paths: readonly string[]): void {
  listeners.forEach((listener) => listener(paths));
}

/** Paths are "/"-separated library paths: the written file, both paths of a rename, or the root of a removed tree. */
export function onLocalFileChanges(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The page's file system, which reports every write it completes; the mirrors write past it, so their own writes come back to none. */
export function reportPageWrites(fs: LibraryFileSystem): LibraryFileSystem {
  const after = <A extends unknown[]>(write: (...args: A) => Promise<void>, paths: (...args: A) => string[]) =>
    async (...args: A): Promise<void> => { await write(...args); report(paths(...args)); };
  // Each method is bound here, since an adapter may keep them on its prototype, which a spread drops.
  return {
    readText: (path) => fs.readText(path),
    exists: (path) => fs.exists(path),
    ensureDir: (path) => fs.ensureDir(path),
    listDir: (path) => fs.listDir(path),
    readFile: (path) => fs.readFile(path),
    stat: (path) => fs.stat(path),
    mkdir: (dir) => fs.mkdir(dir),
    writeText: after((path: string, text: string) => fs.writeText(path, text), (path) => [path]),
    writeFile: after((path: string, bytes: Uint8Array) => fs.writeFile(path, bytes), (path) => [path]),
    deleteFile: after((path: string) => fs.deleteFile(path), (path) => [path]),
    rename: after((from: string, to: string) => fs.rename(from, to), (from, to) => [from, to]),
    trash: after((target: string) => fs.trash(target), (target) => [target]),
    removeTree: after((target: string) => fs.removeTree(target), (target) => [target]),
  };
}
