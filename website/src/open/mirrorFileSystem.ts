// A read-only library file system over the Mirror's Space and Home rows, read once at mount; every write throws the read-only notice.
import type { LibraryFileSystem } from "@labshelf/core";

import type { MirrorRow } from "./mirrorProjects.js";

export const READ_ONLY_NOTICE = "This remote library is read-only. Open LabShelf on your computer to change it.";

const PRELOADED_KINDS = new Set(["space", "home"]);
const CONCURRENCY = 6;

const trim = (path: string): string => path.replace(/^\/+|\/+$/g, "");

/** Reads the text of every Space and Home row, a few at a time; a row that fails to read is left out. */
async function preload(rows: readonly MirrorRow[], read: (path: string) => Promise<string>): Promise<Map<string, { text: string; updated: number }>> {
  const wanted = rows.filter((row) => PRELOADED_KINDS.has(row.kind));
  const files = new Map<string, { text: string; updated: number }>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const row = wanted[next++]!;
      try { files.set(row.path, { text: await read(row.path), updated: row.updated ?? 0 }); } catch { /* left out */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
  return files;
}

export async function createMirrorFileSystem(rows: readonly MirrorRow[], read: (path: string) => Promise<string>): Promise<LibraryFileSystem> {
  const files = await preload(rows, read);
  const dirs = new Set<string>([""]);
  for (const path of files.keys()) {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) { dirs.add(segments.slice(0, i).join("/")); }
  }
  const refuse = async (): Promise<never> => { throw new Error(READ_ONLY_NOTICE); };
  const text = (path: string): string => {
    const file = files.get(trim(path));
    if (!file) { throw new Error(`Not in the remote library: ${path}`); }
    return file.text;
  };
  return {
    async readText(path) { return text(path); },
    async readFile(path) { return new TextEncoder().encode(text(path)); },
    async exists(path) { return files.has(trim(path)) || dirs.has(trim(path)); },
    async listDir(path) {
      const dir = trim(path);
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const key of [...files.keys(), ...dirs]) {
        if (key !== dir && key.startsWith(prefix)) { names.add(key.slice(prefix.length).split("/")[0]!); }
      }
      return [...names].filter(Boolean).sort();
    },
    async stat(path) {
      const key = trim(path);
      const file = files.get(key);
      if (file) { return { isFile: true, isDirectory: false, mtimeMs: file.updated, size: file.text.length }; }
      return dirs.has(key) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    writeText: refuse, writeFile: refuse, deleteFile: refuse, ensureDir: refuse, rename: refuse, trash: refuse, removeTree: refuse, mkdir: refuse,
  };
}
