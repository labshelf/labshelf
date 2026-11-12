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

// CONTRACT: documents/contracts/local-sync.md#disk-writer
/**
 * Every file call runs on one queue in call order, so reads and writes never overlap. A failed call goes to onError and
 * leaves base and the last stat as they were; the next change, check or sync retries.
 */
export function createFileWriter(options: FileWriterOptions): FileWriter {
  const { path, replica, files, textMerge } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  const delay = options.persistDelayMs ?? PERSIST_DELAY_MS;
  let base: string | undefined;
  let lastStat: FileStat | undefined;
  let tail: Promise<void> = Promise.resolve();
  let cancelTimer: (() => void) | undefined;
  let stopped = false;

  const enqueue = (run: () => Promise<void>): Promise<void> => {
    const next = tail.then(run).catch((error: unknown) => { options.onError?.(error); });
    tail = next;
    return next;
  };

  const runSync = async (): Promise<void> => {
    const disk = await files.read(path);
    if (base === undefined) { base = disk; }
    const local = replica.text();
    if (disk === base) {
      if (local !== base) { await files.write(path, local); base = local; }
    } else {
      const result = mergeLocalFile({ path, base, local, other: disk }, textMerge, options.copyId?.());
      if (result.conflict) {
        await files.write(result.conflict.copyPath, result.conflict.text);
        options.onConflict?.(path, result.conflict.copyPath);
      }
      replica.replace(result.text, DISK_ORIGIN);
      if (result.text !== disk) { await files.write(path, result.text); }
      base = result.text;
    }
    lastStat = await files.stat(path);
  };

  const runCheck = async (): Promise<void> => {
    const stat = await files.stat(path);
    if (sameStat(lastStat, stat)) { return; }
    await runSync();
  };

  const persist = (): void => {
    cancelTimer = undefined;
    void enqueue(runSync);
  };

  const onUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (stopped || origin === DISK_ORIGIN) { return; }
    cancelTimer?.();
    cancelTimer = scheduler.after(delay, persist);
  };

  const runStart = async (): Promise<void> => {
    try {
      const disk = await files.read(path);
      base = disk;
      lastStat = await files.stat(path);
    } finally {
      if (!stopped) { replica.doc.on("update", onUpdate); }
    }
    if (base !== undefined && replica.text() !== base) { await runSync(); }
  };

  const flushQueue = (): Promise<void> => {
    if (!cancelTimer) { return enqueue(async () => {}); }
    cancelTimer();
    cancelTimer = undefined;
    return enqueue(runSync);
  };

  return {
    path,
    start: () => (stopped ? enqueue(async () => {}) : enqueue(runStart)),
    check: () => (stopped ? enqueue(async () => {}) : enqueue(runCheck)),
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
