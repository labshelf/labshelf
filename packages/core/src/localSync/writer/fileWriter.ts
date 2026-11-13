// The writer of one file for one replica: keeps the text last read from or written to disk, persists the doc after a quiet spell with a checked write, and takes in outside changes through a stat-gated check.
import { systemScheduler, type SessionScheduler } from "../../collab/channel.js";
import { DISK_ORIGIN } from "../../collab/mirror/fileReconcile.js";
import type { TextMerge } from "../../qmd/item/mergeItemFiles.js";
import { mergeLocalFile } from "../mergeFile.js";
import type { FileStat, WriterFiles, WriterReplica } from "./ports.js";

/** The origin ("disk") of doc changes the writer applies from disk; they are never persisted back. Shared with the collab mirror. */
export { DISK_ORIGIN };

export const PERSIST_DELAY_MS = 300;

export interface FileWriterOptions { path: string; replica: WriterReplica; files: WriterFiles; textMerge: TextMerge; scheduler?: SessionScheduler; persistDelayMs?: number; onConflict?: (path: string, copyPath: string) => void; onError?: (error: unknown) => void; copyId?: () => string }

export interface FileWriter { readonly path: string; start(): Promise<void>; check(): Promise<void>; sync(): Promise<void>; flush(): Promise<void>; stop(): Promise<void> }

function sameStat(a: FileStat | undefined, b: FileStat): boolean {
  return a !== undefined && a.lastModified === b.lastModified && a.size === b.size;
}

/** What the writer last read from or wrote to disk: the text, and the stat that gates the next check. */
interface DiskState { base: string | undefined; lastStat: FileStat | undefined }

async function syncFile(options: FileWriterOptions, state: DiskState): Promise<void> {
  const { path, replica, files, textMerge } = options;
  const disk = await files.read(path);
  if (state.base === undefined) { state.base = disk; }
  const local = replica.text();
  if (disk === state.base) {
    if (local !== state.base) { await files.write(path, local); state.base = local; }
  } else {
    const result = mergeLocalFile({ path, base: state.base, local, other: disk }, textMerge, options.copyId?.());
    if (result.conflict) {
      await files.write(result.conflict.copyPath, result.conflict.text);
      options.onConflict?.(path, result.conflict.copyPath);
    }
    replica.replace(result.text, DISK_ORIGIN);
    if (result.text !== disk) { await files.write(path, result.text); }
    state.base = result.text;
  }
  state.lastStat = await options.files.stat(path);
}

async function checkFile(options: FileWriterOptions, state: DiskState): Promise<void> {
  const stat = await options.files.stat(options.path);
  if (sameStat(state.lastStat, stat)) { return; }
  await syncFile(options, state);
}

/** Reads the file, then `attach` starts the doc listener; a doc that differs from the disk is synced at once. */
async function startFile(options: FileWriterOptions, state: DiskState, attach: () => void): Promise<void> {
  try {
    state.base = await options.files.read(options.path);
    state.lastStat = await options.files.stat(options.path);
  } finally {
    attach();
  }
  if (state.base !== undefined && options.replica.text() !== state.base) { await syncFile(options, state); }
}

// CONTRACT: documents/contracts/local-sync.md#disk-writer
/**
 * Every file call runs on one queue in call order, so reads and writes never overlap. A failed call goes to onError and
 * leaves base and the last stat as they were; the next change, check or sync retries.
 */
export function createFileWriter(options: FileWriterOptions): FileWriter {
  const { path, replica } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  const delay = options.persistDelayMs ?? PERSIST_DELAY_MS;
  const state: DiskState = { base: undefined, lastStat: undefined };
  let tail: Promise<void> = Promise.resolve();
  let cancelTimer: (() => void) | undefined;
  let stopped = false;

  const enqueue = (run: () => Promise<void>): Promise<void> => {
    const next = tail.then(run).catch((error: unknown) => { options.onError?.(error); });
    tail = next;
    return next;
  };

  const runSync = (): Promise<void> => syncFile(options, state);

  const persist = (): void => {
    cancelTimer = undefined;
    void enqueue(runSync);
  };

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (stopped || origin === DISK_ORIGIN) { return; }
    cancelTimer?.();
    cancelTimer = scheduler.after(delay, persist);
  };

  const flushQueue = (): Promise<void> => {
    if (!cancelTimer) { return enqueue(async () => {}); }
    cancelTimer();
    cancelTimer = undefined;
    return enqueue(runSync);
  };

  return {
    path,
    start: () => (stopped ? enqueue(async () => {}) : enqueue(() => startFile(options, state, () => { if (!stopped) { replica.doc.on("update", onUpdate); } }))),
    check: () => (stopped ? enqueue(async () => {}) : enqueue(() => checkFile(options, state))),
    sync: () => (stopped ? enqueue(async () => {}) : enqueue(runSync)),
    flush: () => (stopped ? enqueue(async () => {}) : flushQueue()),
    stop: () => {
      if (stopped) { return enqueue(async () => {}); }
      stopped = true;
      replica.doc.off("update", onUpdate);
      return flushQueue();
    },
  };
}
