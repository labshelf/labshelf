// Lists and stats the demo library's folders from its file list, for core's paper file listing.
import type { LibraryFileSystem, LocalStat } from "@labshelf/core";

import type { DemoFile } from "./demoLibrary.js";

export function createMemoryFileSystem(files: readonly DemoFile[]): Pick<LibraryFileSystem, "listDir" | "stat"> {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const isDir = (path: string): boolean => files.some((f) => f.path.startsWith(`${path}/`));
  return {
    listDir: async (dir) => {
      const names = new Set<string>();
      for (const f of files) if (f.path.startsWith(`${dir}/`)) names.add(f.path.slice(dir.length + 1).split("/")[0]!);
      return [...names];
    },
    stat: async (path): Promise<LocalStat | undefined> => {
      const file = byPath.get(path);
      if (file) return { isFile: true, isDirectory: false, mtimeMs: Date.parse(file.modified), size: file.size };
      return isDir(path) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
  };
}
