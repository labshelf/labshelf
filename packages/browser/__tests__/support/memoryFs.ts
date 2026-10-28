// A minimal in-memory LibraryFileSystem over "/" paths, for the session tests.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

export function memoryFs(files: Record<string, string>): LibraryFileSystem {
  const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
  const paths = Object.keys(files);
  const isDir = (dir: string): boolean => paths.some((p) => p.startsWith(`${dir}/`));
  const unsupported = async (): Promise<never> => { throw new Error("read-only fake"); };
  return {
    listDir: async (dir) => [...new Set(paths.filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1).split("/")[0]!))],
    stat: async (target): Promise<LocalStat | undefined> => {
      if (target in files) { return { isFile: true, isDirectory: false, mtimeMs: 0, size: files[target]!.length }; }
      return isDir(target) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    exists: async (target) => target in files || isDir(target),
    readText: async (target) => {
      const text = files[target];
      if (text === undefined) { throw new Error(`ENOENT: ${target}`); }
      return text;
    },
    readFile: async (target) => encode(files[target] ?? ""),
    writeFile: unsupported, writeText: unsupported, deleteFile: unsupported, ensureDir: unsupported,
    rename: unsupported, trash: unsupported, removeTree: unsupported, mkdir: unsupported,
  };
}
