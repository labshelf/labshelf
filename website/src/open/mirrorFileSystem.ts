// The library file system of /open/ over the Mirror: Space and Home rows read at mount, other rows on first read, every write sent as an edit, a refused text edit merged with the Mirror's row and sent again, and watched files re-checked against the Mirror's index.
// CONTRACT: documents/contracts/remote-library.md#edits
import { mergeLocalFile, type LibraryFileSystem, type TextMerge } from "@labshelf/core";

import type { MirrorRow } from "./mirrorProjects.js";
import { mirrorTextMerge } from "./mirrorText.js";
import type { RemoteLibraryClient } from "./remoteClient.js";

export const CONFLICT_NOTICE = "This file changed elsewhere. Reload to see the latest version.";
const MOVE_NOTICE = "Moving or deleting folders is not available in the remote library. Open LabShelf on your computer to do it.";

/** The text kinds the page reads as strings; the others are bytes. */
const BINARY_KINDS = new Set(["output", "asset", "pdf"]);
const PRELOADED_KINDS = new Set(["space", "home"]);
const CONCURRENCY = 6;
/** How long a write waits for the next one to the same path, which replaces it. */
const WRITE_DELAY_MS = 1000;
/** A refused text edit is merged and sent again; after this many sends in all it rejects with {@link CONFLICT_NOTICE}. */
const MAX_SENDS = 3;

type Data = string | Uint8Array;
type Client = Pick<RemoteLibraryClient, "file" | "bytes" | "hashOf" | "write" | "remove"> & Partial<Pick<RemoteLibraryClient, "index">>;

/** A text the file system took in from the Mirror: `previous` is the text it held (or sent), `text` the one it holds now. */
export interface MirrorTextChange { path: string; previous: string; text: string }

/**
 * The file system plus `flush`, which sends every waiting write now (on page hide), `watch`, which tells a listener of every text
 * taken in from the Mirror for a path, and `recheck`, which reads watched files whose row changed in the Mirror's index.
 */
export type MirrorFileSystem = LibraryFileSystem & { flush(): Promise<void>; watch(path: string, listener: (change: MirrorTextChange) => void): () => void; recheck(): Promise<void> }

type Listener = (change: MirrorTextChange) => void;
interface Pending { data: Data; timer: ReturnType<typeof setTimeout>; waiters: { resolve(): void; reject(error: unknown): void }[] }
/** The text last read from the Mirror or last accepted by it, and the row hash it had then. */
interface Base { hash: string; text: string }

interface State {
  client: Client; textMerge: TextMerge; delayMs: number; rows: readonly MirrorRow[];
  kinds: Map<string, string>; updated: Map<string, number>; files: Map<string, Data>; dirs: Set<string>; bases: Map<string, Base>;
  pending: Map<string, Pending>;
  /** Writes taken out of `pending` that wait for the send before them; their data is read when they are sent. */
  queued: Map<string, Pending[]>;
  // Sends to one path run one after another, so each takes the hash the one before it got as base.
  sending: Map<string, Promise<void>>;
  watchers: Map<string, Set<Listener>>;
  rechecking: Promise<void> | undefined;
}

const trim = (path: string): string => path.replace(/^\/+|\/+$/g, "");
const sameData = (a: Data, b: Data): boolean =>
  typeof a === "string" || typeof b === "string" ? a === b : a.length === b.length && a.every((byte, i) => byte === b[i]);
const conflict = (): Error => new Error(CONFLICT_NOTICE);

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

/** Reads a row's text and keeps it as the path's base, with the hash the client held when the read started. */
async function readBase(s: State, key: string): Promise<string> {
  const hash = s.client.hashOf(key);
  const text = await s.client.file(key);
  if (!s.files.has(key)) { s.bases.set(key, { hash, text }); }
  return text;
}

async function load(s: State, path: string): Promise<Data> {
  const key = trim(path);
  const held = s.files.get(key);
  if (held !== undefined) { return held; }
  if (!s.kinds.has(key)) { throw new Error(`Not in the remote library: ${path}`); }
  const data = BINARY_KINDS.has(s.kinds.get(key)!) ? await s.client.bytes(key) : await readBase(s, key);
  if (!s.files.has(key)) { s.files.set(key, data); }
  return s.files.get(key)!;
}

/** INVARIANT: the base hash is the file system's, not the client's: client.index() refreshes the client's, which would skip the merge. */
const baseHash = (s: State, key: string): string => s.bases.get(key)?.hash ?? s.client.hashOf(key);

function notify(s: State, change: MirrorTextChange): void {
  for (const listener of [...(s.watchers.get(change.path) ?? [])]) {
    try { listener(change); } catch { /* one failing listener does not stop the others */ }
  }
}

/** After a merged text was accepted: rebases the newer writes still to send onto it, or holds it, then tells the watchers. */
function takeIn(s: State, key: string, sent: string, merged: string): void {
  const newer = [...(s.queued.get(key) ?? []), s.pending.get(key)].filter((entry): entry is Pending => entry !== undefined);
  if (newer.length === 0) { s.files.set(key, merged); }
  for (const entry of newer) {
    if (typeof entry.data !== "string") { continue; }
    entry.data = mergeLocalFile({ path: key, base: sent, local: entry.data, other: merged }, s.textMerge).text;
    s.files.set(key, entry.data);
  }
  notify(s, { path: key, previous: sent, text: merged });
}

/** Sends a text; a 409 reads the row, merges it with the sent text against the base and sends again, up to {@link MAX_SENDS} sends. */
async function sendText(s: State, key: string, sent: string): Promise<void> {
  let text = sent;
  let hash = baseHash(s, key);
  for (let sends = 1; ; sends++) {
    const answer = await s.client.write(key, text, hash);
    if (answer.ok) {
      s.bases.set(key, { hash: answer.hash, text });
      if (text !== sent) { takeIn(s, key, sent, text); }
      return;
    }
    const base = s.bases.get(key);
    if (!base || sends >= MAX_SENDS) { throw conflict(); }
    const merged = mergeLocalFile({ path: key, base: base.text, local: sent, other: await s.client.file(key) }, s.textMerge);
    if (merged.conflict) { throw conflict(); }
    text = merged.text;
    hash = answer.hash;
  }
}

async function sendData(s: State, key: string, data: Data): Promise<void> {
  if (typeof data === "string") {
    await sendText(s, key, data);
  } else {
    const answer = await s.client.write(key, data, baseHash(s, key));
    if (!answer.ok) { throw conflict(); }
    s.bases.delete(key);
  }
  s.updated.set(key, Date.now());
}

function send(s: State, key: string): Promise<void> {
  const entry = s.pending.get(key);
  if (!entry) { return s.sending.get(key) ?? Promise.resolve(); }
  clearTimeout(entry.timer);
  s.pending.delete(key);
  s.queued.set(key, [...(s.queued.get(key) ?? []), entry]);
  const previous = s.sending.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(() => {
    const waiting = (s.queued.get(key) ?? []).filter((queued) => queued !== entry);
    if (waiting.length === 0) { s.queued.delete(key); } else { s.queued.set(key, waiting); }
    return sendData(s, key, entry.data);
  });
  s.sending.set(key, run);
  run.then(() => { for (const w of entry.waiters) { w.resolve(); } }, (error: unknown) => { for (const w of entry.waiters) { w.reject(error); } })
    .finally(() => { if (s.sending.get(key) === run) { s.sending.delete(key); } });
  return run.catch(() => undefined);
}

function write(s: State, path: string, data: Data): Promise<void> {
  const key = trim(path);
  const held = s.files.get(key);
  const waiting = s.pending.get(key);
  if (!waiting && held !== undefined && sameData(held, data)) { return Promise.resolve(); }
  s.files.set(key, data);
  s.kinds.set(key, s.kinds.get(key) ?? (typeof data === "string" ? "source" : "asset"));
  addDirs(s.dirs, key);
  return new Promise<void>((resolve, reject) => {
    const entry: Pending = { data, timer: setTimeout(() => { void send(s, key); }, s.delayMs), waiters: [...(waiting?.waiters ?? []), { resolve, reject }] };
    if (waiting) { clearTimeout(waiting.timer); }
    s.pending.set(key, entry);
  });
}

async function deleteFile(s: State, path: string): Promise<void> {
  const key = trim(path);
  const waiting = s.pending.get(key);
  if (waiting) { clearTimeout(waiting.timer); s.pending.delete(key); for (const w of waiting.waiters) { w.resolve(); } }
  await s.sending.get(key)?.catch(() => undefined);
  const answer = await s.client.remove(key, baseHash(s, key));
  if (!answer.ok) { throw conflict(); }
  s.files.delete(key);
  s.kinds.delete(key);
  s.bases.delete(key);
}

const busy = (s: State, key: string): boolean => s.pending.has(key) || s.queued.has(key) || s.sending.has(key);

/** Takes in a watched path's newer row; a path with a write to send is left to that send, which meets the 409 and merges. */
async function recheckPath(s: State, key: string, hash: string): Promise<void> {
  if (busy(s, key)) { return; }
  let text: string;
  try { text = await s.client.file(key); } catch { return; }
  const held = s.files.get(key);
  if (busy(s, key) || typeof held !== "string") { return; }
  s.bases.set(key, { hash, text });
  if (text === held) { return; }
  s.files.set(key, text);
  notify(s, { path: key, previous: held, text });
}

async function recheckPass(s: State): Promise<void> {
  if (s.client.index === undefined) { return; }
  let rows: Awaited<ReturnType<RemoteLibraryClient["index"]>>;
  try { rows = await s.client.index(); } catch { return; }
  const hashes = new Map(rows.map((row) => [row.path, row.hash]));
  const changed = [...s.watchers.keys()].filter((key) => {
    const base = s.bases.get(key);
    const hash = hashes.get(key);
    return (s.watchers.get(key)?.size ?? 0) > 0 && base !== undefined && hash !== undefined && hash !== base.hash;
  });
  await Promise.all(changed.map((key) => recheckPath(s, key, hashes.get(key)!)));
}

function recheck(s: State): Promise<void> {
  s.rechecking ??= recheckPass(s).finally(() => { s.rechecking = undefined; });
  return s.rechecking;
}

function watch(s: State, path: string, listener: Listener): () => void {
  const key = trim(path);
  const set = s.watchers.get(key) ?? new Set<Listener>();
  s.watchers.set(key, set);
  const own = (change: MirrorTextChange): void => { listener(change); };
  set.add(own);
  return () => { set.delete(own); if (set.size === 0 && s.watchers.get(key) === set) { s.watchers.delete(key); } };
}

function addDirs(dirs: Set<string>, path: string): void {
  const segments = path.split("/");
  for (let i = 1; i < segments.length; i++) { dirs.add(segments.slice(0, i).join("/")); }
}

function listDir(s: State, path: string): string[] {
  const dir = trim(path);
  const prefix = dir === "" ? "" : `${dir}/`;
  const names = new Set<string>();
  for (const key of [...s.kinds.keys(), ...s.dirs]) {
    if (key !== dir && key.startsWith(prefix)) { names.add(key.slice(prefix.length).split("/")[0]!); }
  }
  return [...names].filter(Boolean).sort();
}

const size = (data: Data): number => typeof data === "string" ? new TextEncoder().encode(data).length : data.length;

function stat(s: State, path: string): { isFile: boolean; isDirectory: boolean; mtimeMs: number; size: number } | undefined {
  const key = trim(path);
  if (s.kinds.has(key)) {
    const data = s.files.get(key);
    const row = s.rows.find((r) => r.path === key);
    return { isFile: true, isDirectory: false, mtimeMs: s.updated.get(key) ?? 0, size: data === undefined ? row?.size ?? 0 : size(data) };
  }
  return s.dirs.has(key) ? { isFile: false, isDirectory: true, mtimeMs: 0, size: 0 } : undefined;
}

async function createState(rows: readonly MirrorRow[], client: Client, delayMs: number, textMerge: TextMerge): Promise<State> {
  const bases = new Map<string, Base>();
  const files = await preload(rows, async (path) => {
    const hash = client.hashOf(path);
    const text = await client.file(path);
    bases.set(path, { hash, text });
    return text;
  });
  const s: State = {
    client, textMerge, delayMs, rows, files, bases,
    kinds: new Map(rows.map((row) => [row.path, row.kind])), updated: new Map(rows.map((row) => [row.path, row.updated ?? 0])),
    dirs: new Set<string>([""]), pending: new Map(), queued: new Map(), sending: new Map(), watchers: new Map(), rechecking: undefined,
  };
  for (const path of s.kinds.keys()) { addDirs(s.dirs, path); }
  return s;
}

/**
 * TRAP: Spaces write space.json when it is only viewed (markSeen, toggleSaved); a write of the text already held sends nothing, and writes
 * to one path within {@link WRITE_DELAY_MS} send once, the last one winning, with the base hash the file system holds for the path.
 * A refused text edit is merged with the Mirror's row (qmd item by item, other text line by line) and sent again; an overlapping
 * change, a refused byte edit or a refused delete keeps the page's text in memory and rejects with {@link CONFLICT_NOTICE}.
 */
export async function createMirrorFileSystem(rows: readonly MirrorRow[], client: Client, delayMs = WRITE_DELAY_MS, textMerge: TextMerge = mirrorTextMerge): Promise<MirrorFileSystem> {
  const s = await createState(rows, client, delayMs, textMerge);
  const refuse = async (): Promise<never> => { throw new Error(MOVE_NOTICE); };
  return {
    async readText(path) { const data = await load(s, path); return typeof data === "string" ? data : new TextDecoder().decode(data); },
    async readFile(path) { const data = await load(s, path); return typeof data === "string" ? new TextEncoder().encode(data) : data; },
    async exists(path) { return s.kinds.has(trim(path)) || s.dirs.has(trim(path)); },
    async listDir(path) { return listDir(s, path); },
    async stat(path) { return stat(s, path); },
    writeText: (path, data) => write(s, path, data),
    writeFile: (path, data) => write(s, path, data),
    deleteFile: (path) => deleteFile(s, path),
    async ensureDir(path) { const key = trim(path); if (key !== "") { addDirs(s.dirs, `${key}/x`); } },
    async mkdir(path) { const key = trim(path); if (key !== "") { addDirs(s.dirs, `${key}/x`); } },
    // CONTRACT: a deletion made here deletes the file on the owner's computer, where trash keeps it; so trash, tree removal and moves stay refused.
    rename: refuse, trash: refuse, removeTree: refuse,
    async flush() { await Promise.all([...s.pending.keys()].map((key) => send(s, key))); await Promise.all([...s.sending.values()].map((p) => p.catch(() => undefined))); },
    watch: (path, listener) => watch(s, path, listener),
    recheck: () => recheck(s),
  };
}
