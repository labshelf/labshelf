// The library file system of /open/ over the Mirror: Space and Home rows read at mount, other rows on first read, and every write sent as an edit.
import type { LibraryFileSystem } from "@labshelf/core";

import type { MirrorRow } from "./mirrorProjects.js";
import type { RemoteLibraryClient } from "./remoteClient.js";

export const CONFLICT_NOTICE = "This file changed elsewhere. Reload to see the latest version.";
const MOVE_NOTICE = "Moving or deleting folders is not available in the remote library. Open LabShelf on your computer to do it.";

/** The text kinds the page reads as strings; the others are bytes. */
const BINARY_KINDS = new Set(["output", "asset", "pdf"]);
const PRELOADED_KINDS = new Set(["space", "home"]);
const CONCURRENCY = 6;
/** How long a write waits for the next one to the same path, which replaces it. */
const WRITE_DELAY_MS = 1000;

type Data = string | Uint8Array;
type Client = Pick<RemoteLibraryClient, "file" | "bytes" | "hashOf" | "write" | "remove">;

/** The file system plus `flush`, which sends every waiting write now (on page hide). */
export type MirrorFileSystem = LibraryFileSystem & { flush(): Promise<void> };

interface Pending { data: Data; timer: ReturnType<typeof setTimeout>; waiters: { resolve(): void; reject(error: unknown): void }[] }

const trim = (path: string): string => path.replace(/^\/+|\/+$/g, "");
const sameData = (a: Data, b: Data): boolean =>
  typeof a === "string" || typeof b === "string" ? a === b : a.length === b.length && a.every((byte, i) => byte === b[i]);

/** Reads the text of every Space and Home row, a few at a time; a row that fails to read is left out. */
async function preload(rows: readonly MirrorRow[], read: (path: string) => Promise<string>): Promise<Map<string, Data>> {
  const wanted = rows.filter((row) => PRELOADED_KINDS.has(row.kind));
  const files = new Map<string, Data>();
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const row = wanted[next++]!;
      try { files.set(row.path, await read(row.path)); } catch { /* left out */ }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, wanted.length) }, worker));
  return files;
}

/**
 * TRAP: Spaces write space.json when it is only viewed (markSeen, toggleSaved); a write of the text already held sends nothing, and writes
 * to one path within {@link WRITE_DELAY_MS} send once, the last one winning, with the hash of the last accepted edit as base.
 * A conflict keeps the page's text in memory and rejects with {@link CONFLICT_NOTICE}.
 */
export async function createMirrorFileSystem(rows: readonly MirrorRow[], client: Client, delayMs = WRITE_DELAY_MS): Promise<MirrorFileSystem> {
  const kinds = new Map(rows.map((row) => [row.path, row.kind]));
  const updated = new Map(rows.map((row) => [row.path, row.updated ?? 0]));
  const files = await preload(rows, (path) => client.file(path));
  const dirs = new Set<string>([""]);
  const addDirs = (path: string): void => {
    const segments = path.split("/");
    for (let i = 1; i < segments.length; i++) { dirs.add(segments.slice(0, i).join("/")); }
  };
  for (const path of kinds.keys()) { addDirs(path); }
  const pending = new Map<string, Pending>();
  // Sends to one path run one after another, so each takes the hash the one before it got as base.
  const sending = new Map<string, Promise<void>>();

  const load = async (path: string): Promise<Data> => {
    const key = trim(path);
    const held = files.get(key);
    if (held !== undefined) { return held; }
    if (!kinds.has(key)) { throw new Error(`Not in the remote library: ${path}`); }
    const data = BINARY_KINDS.has(kinds.get(key)!) ? await client.bytes(key) : await client.file(key);
    if (!files.has(key)) { files.set(key, data); }
    return files.get(key)!;
  };
  const send = (key: string): Promise<void> => {
    const entry = pending.get(key);
    if (!entry) { return sending.get(key) ?? Promise.resolve(); }
    clearTimeout(entry.timer);
    pending.delete(key);
    const previous = sending.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(async () => {
      const answer = await client.write(key, entry.data, client.hashOf(key));
      if (!answer.ok) { throw new Error(CONFLICT_NOTICE); }
      updated.set(key, Date.now());
    });
    sending.set(key, run);
    run.then(() => { for (const w of entry.waiters) { w.resolve(); } }, (error: unknown) => { for (const w of entry.waiters) { w.reject(error); } })
      .finally(() => { if (sending.get(key) === run) { sending.delete(key); } });
    return run.catch(() => undefined);
  };
  const write = (path: string, data: Data): Promise<void> => {
    const key = trim(path);
    const held = files.get(key);
    const waiting = pending.get(key);
    if (!waiting && held !== undefined && sameData(held, data)) { return Promise.resolve(); }
    files.set(key, data);
    kinds.set(key, kinds.get(key) ?? (typeof data === "string" ? "source" : "asset"));
    addDirs(key);
    return new Promise<void>((resolve, reject) => {
      const entry: Pending = { data, timer: setTimeout(() => { void send(key); }, delayMs), waiters: [...(waiting?.waiters ?? []), { resolve, reject }] };
      if (waiting) { clearTimeout(waiting.timer); }
      pending.set(key, entry);
    });
  };
  const deleteFile = async (path: string): Promise<void> => {
    const key = trim(path);
    const waiting = pending.get(key);
    if (waiting) { clearTimeout(waiting.timer); pending.delete(key); for (const w of waiting.waiters) { w.resolve(); } }
    await sending.get(key)?.catch(() => undefined);
    const answer = await client.remove(key, client.hashOf(key));
    if (!answer.ok) { throw new Error(CONFLICT_NOTICE); }
    files.delete(key);
    kinds.delete(key);
  };
  const refuse = async (): Promise<never> => { throw new Error(MOVE_NOTICE); };
  const size = (data: Data): number => typeof data === "string" ? new TextEncoder().encode(data).length : data.length;
  return {
    async readText(path) { const data = await load(path); return typeof data === "string" ? data : new TextDecoder().decode(data); },
    async readFile(path) { const data = await load(path); return typeof data === "string" ? new TextEncoder().encode(data) : data; },
    async exists(path) { return kinds.has(trim(path)) || dirs.has(trim(path)); },
    async listDir(path) {
      const dir = trim(path);
      const prefix = dir === "" ? "" : `${dir}/`;
      const names = new Set<string>();
      for (const key of [...kinds.keys(), ...dirs]) {
        if (key !== dir && key.startsWith(prefix)) { names.add(key.slice(prefix.length).split("/")[0]!); }
      }
      return [...names].filter(Boolean).sort();
    },
    async stat(path) {
      const key = trim(path);
      if (kinds.has(key)) {
        const data = files.get(key);
        const row = rows.find((r) => r.path === key);
        return { isFile: true, isDirectory: false, mtimeMs: updated.get(key) ?? 0, size: data === undefined ? row?.size ?? 0 : size(data) };
      }
      return dirs.has(key) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
    },
    writeText: write,
    writeFile: write,
    deleteFile,
    async ensureDir(path) { const key = trim(path); if (key !== "") { addDirs(`${key}/x`); } },
    async mkdir(path) { const key = trim(path); if (key !== "") { addDirs(`${key}/x`); } },
    // CONTRACT: a deletion made here deletes the file on the owner's computer, where trash keeps it; so trash, tree removal and moves stay refused.
    rename: refuse, trash: refuse, removeTree: refuse,
    async flush() { await Promise.all([...pending.keys()].map(send)); await Promise.all([...sending.values()].map((p) => p.catch(() => undefined))); },
  };
}
