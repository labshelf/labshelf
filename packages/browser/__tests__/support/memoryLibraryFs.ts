// A writable in-memory LibraryFileSystem over "/"-separated paths, for tests that write into the library folder.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

export function memoryLibraryFs(): LibraryFileSystem {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>([""]);
  const addParents = (path: string): void => { for (let i = path.lastIndexOf("/"); i > 0; i = path.lastIndexOf("/", i - 1)) dirs.add(path.slice(0, i)); };
  const missing = (path: string): Error => Object.assign(new Error(`${path} not found`), { code: "ENOENT" });
  const stat = (isDirectory: boolean): LocalStat => ({ isFile: !isDirectory, isDirectory, mtimeMs: 1, size: 0 });
  const under = (dir: string, path: string): boolean => (dir === "" ? true : path.startsWith(`${dir}/`));
  const rest = (dir: string, path: string): string => (dir === "" ? path : path.slice(dir.length + 1));
  const fs: LibraryFileSystem = {
    writeFile: async (path, bytes) => { addParents(path); files.set(path, bytes); },
    writeText: async (path, text) => fs.writeFile(path, new TextEncoder().encode(text)),
    readFile: async (path) => { const bytes = files.get(path); if (!bytes) throw missing(path); return bytes; },
    readText: async (path) => new TextDecoder().decode(await fs.readFile(path)),
    exists: async (path) => files.has(path) || dirs.has(path),
    stat: async (path) => (files.has(path) ? stat(false) : dirs.has(path) ? stat(true) : undefined),
    listDir: async (dir) => {
      if (!dirs.has(dir)) return [];
      const names = [...files.keys(), ...dirs].filter((p) => p !== dir && under(dir, p)).map((p) => rest(dir, p).split("/")[0]!);
      return [...new Set(names)];
    },
    ensureDir: async (dir) => { addParents(`${dir}/x`); },
    mkdir: async (dir) => { addParents(`${dir}/x`); },
    deleteFile: async (path) => { files.delete(path); },
    removeTree: async (path) => { for (const p of [...files.keys()]) if (p === path || p.startsWith(`${path}/`)) files.delete(p); for (const d of [...dirs]) if (d === path || d.startsWith(`${path}/`)) dirs.delete(d); },
    trash: async (path) => fs.removeTree(path),
    rename: async (from, to) => {
      for (const [p, bytes] of [...files]) if (p === from || p.startsWith(`${from}/`)) { files.delete(p); await fs.writeFile(to + p.slice(from.length), bytes); }
      for (const d of [...dirs]) if (d === from || d.startsWith(`${from}/`)) { dirs.delete(d); dirs.add(to + d.slice(from.length)); }
    },
  };
  return fs;
}
