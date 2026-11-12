// The writers of the files a page holds as replicas: one writer per file under its Web Lock, watched by an observer or a visible-page stat poll.
import { systemScheduler, type SessionScheduler } from "../../collab/channel.js";
import type { TextMerge } from "../../qmd/item/mergeItemFiles.js";
import { createFileWriter, type FileWriter } from "./fileWriter.js";
import type { WriterFiles, WriterLock, WriterObserver, WriterReplica, WriterVisibility } from "./ports.js";

export const POLL_MS = 2000;

export function writerLockName(libraryId: string, path: string): string {
  return `labshelf:file:${libraryId}:${path}`;
}

export interface DiskWritersOptions { libraryId: string; files: WriterFiles; lock: WriterLock; visibility: WriterVisibility; observer?: WriterObserver; textMerge: TextMerge; scheduler?: SessionScheduler; pollMs?: number; persistDelayMs?: number; onConflict?: (path: string, copyPath: string) => void; onError?: (error: unknown) => void }

export interface DiskWriters { attach(path: string, replica: WriterReplica): () => Promise<void>; changed(path: string): void; isWriter(path: string): boolean; flush(path: string): Promise<void>; close(): Promise<void> }

interface Attached {
  readonly replica: WriterReplica;
  count: number;
  cancelLock: () => void;
  writer?: FileWriter;
  stopObserve?: () => void;
}

// CONTRACT: documents/contracts/local-sync.md#disk-writer
/**
 * A path's first attach queues its lock; the grant creates and starts its writer. Without an observer one page timer
 * checks every held writer while the page is visible, armed only while a writer exists.
 */
export function createDiskWriters(options: DiskWritersOptions): DiskWriters {
  const { libraryId, files, lock, visibility, observer, textMerge } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  const pollMs = options.pollMs ?? POLL_MS;
  const attached = new Map<string, Attached>();
  let cancelPoll: (() => void) | undefined;
  let closed = false;

  const writers = (): FileWriter[] => [...attached.values()].flatMap((entry) => (entry.writer ? [entry.writer] : []));
  const polled = (): FileWriter[] => [...attached.values()].flatMap((entry) => (entry.writer && !entry.stopObserve ? [entry.writer] : []));
  const checkAll = (list: FileWriter[]): void => { for (const writer of list) { void writer.check(); } };

  const pollTick = (): void => {
    cancelPoll = undefined;
    if (visibility.visible()) { checkAll(polled()); }
    armPoll();
  };
  function armPoll(): void {
    if (cancelPoll || closed || polled().length === 0) { return; }
    cancelPoll = scheduler.after(pollMs, pollTick);
  }
  const disarmPollIfIdle = (): void => {
    if (polled().length > 0) { return; }
    cancelPoll?.();
    cancelPoll = undefined;
  };

  const stopVisible = visibility.onVisible(() => { checkAll(writers()); });

  const grant = (path: string, entry: Attached): void => {
    if (attached.get(path) !== entry || entry.writer) { return; }
    const writer = createFileWriter({
      path, replica: entry.replica, files, textMerge, scheduler,
      ...(options.persistDelayMs === undefined ? {} : { persistDelayMs: options.persistDelayMs }),
      ...(options.onConflict ? { onConflict: options.onConflict } : {}),
      ...(options.onError ? { onError: options.onError } : {}),
    });
    entry.writer = writer;
    void writer.start();
    if (observer) {
      entry.stopObserve = observer.observe(path, () => { void writer.sync(); });
    } else {
      armPoll();
    }
  };

  const drop = async (path: string, entry: Attached): Promise<void> => {
    if (attached.get(path) !== entry) { return; }
    attached.delete(path);
    entry.stopObserve?.();
    disarmPollIfIdle();
    const writer = entry.writer;
    if (writer) {
      try { await writer.stop(); } finally { entry.cancelLock(); }
    } else {
      entry.cancelLock();
    }
  };

  const attach = (path: string, replica: WriterReplica): (() => Promise<void>) => {
    if (closed) { throw new Error("disk writers are closed"); }
    let entry = attached.get(path);
    if (entry) {
      if (entry.replica !== replica) { throw new Error(`another replica is already attached to ${path}`); }
      entry.count += 1;
    } else {
      const created: Attached = { replica, count: 1, cancelLock: () => undefined };
      attached.set(path, created);
      created.cancelLock = lock.request(writerLockName(libraryId, path), () => { grant(path, created); });
      entry = created;
    }
    const held = entry;
    let released = false;
    return async () => {
      if (released) { return; }
      released = true;
      held.count -= 1;
      if (held.count <= 0) { await drop(path, held); }
    };
  };

  return {
    attach,
    changed(path) {
      const writer = attached.get(path)?.writer;
      if (writer) { void writer.sync(); }
    },
    isWriter(path) { return attached.get(path)?.writer !== undefined; },
    async flush(path) { await attached.get(path)?.writer?.flush(); },
    async close() {
      if (closed) { return; }
      closed = true;
      stopVisible();
      cancelPoll?.();
      cancelPoll = undefined;
      await Promise.all([...attached].map(([path, entry]) => drop(path, entry)));
    },
  };
}
