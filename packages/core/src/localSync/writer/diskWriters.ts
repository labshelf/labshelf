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

/** Creates and starts the writer of a granted path; an observer wakes it, else the page poll covers it. */
function startWriter(options: DiskWritersOptions, scheduler: SessionScheduler, path: string, entry: Attached, armPoll: () => void): void {
  const writer = createFileWriter({
    path, replica: entry.replica, files: options.files, textMerge: options.textMerge, scheduler,
    ...(options.persistDelayMs === undefined ? {} : { persistDelayMs: options.persistDelayMs }),
    ...(options.onConflict ? { onConflict: options.onConflict } : {}),
    ...(options.onError ? { onError: options.onError } : {}),
  });
  entry.writer = writer;
  void writer.start();
  if (options.observer) {
    entry.stopObserve = options.observer.observe(path, () => { void writer.sync(); });
  } else {
    armPoll();
  }
}

/** Stops the writer of a dropped path, then gives its lock back. */
async function stopWriter(entry: Attached): Promise<void> {
  const writer = entry.writer;
  if (writer) {
    try { await writer.stop(); } finally { entry.cancelLock(); }
  } else {
    entry.cancelLock();
  }
}

/** The one page timer that checks every writer without an observer while the page is visible; armed only while such a writer exists. */
function createPoller(scheduler: SessionScheduler, pollMs: number, visibility: WriterVisibility, polled: () => FileWriter[], isClosed: () => boolean) {
  let cancel: (() => void) | undefined;
  const tick = (): void => {
    cancel = undefined;
    if (visibility.visible()) { for (const writer of polled()) { void writer.check(); } }
    arm();
  };
  function arm(): void {
    if (cancel || isClosed() || polled().length === 0) { return; }
    cancel = scheduler.after(pollMs, tick);
  }
  return {
    arm,
    disarmIfIdle(): void {
      if (polled().length > 0) { return; }
      cancel?.();
      cancel = undefined;
    },
    stop(): void {
      cancel?.();
      cancel = undefined;
    },
  };
}

// CONTRACT: documents/contracts/local-sync.md#disk-writer
/**
 * A path's first attach queues its lock; the grant creates and starts its writer. Without an observer one page timer
 * checks every held writer while the page is visible, armed only while a writer exists.
 */
export function createDiskWriters(options: DiskWritersOptions): DiskWriters {
  const { libraryId, lock, visibility } = options;
  const scheduler = options.scheduler ?? systemScheduler;
  const attached = new Map<string, Attached>();
  let closed = false;

  const writers = (): FileWriter[] => [...attached.values()].flatMap((entry) => (entry.writer ? [entry.writer] : []));
  const polled = (): FileWriter[] => [...attached.values()].flatMap((entry) => (entry.writer && !entry.stopObserve ? [entry.writer] : []));
  const poller = createPoller(scheduler, options.pollMs ?? POLL_MS, visibility, polled, () => closed);

  const stopVisible = visibility.onVisible(() => { for (const writer of writers()) { void writer.check(); } });

  const grant = (path: string, entry: Attached): void => {
    if (attached.get(path) === entry && !entry.writer) { startWriter(options, scheduler, path, entry, poller.arm); }
  };
  const drop = async (path: string, entry: Attached): Promise<void> => {
    if (attached.get(path) !== entry) { return; }
    attached.delete(path);
    entry.stopObserve?.();
    poller.disarmIfIdle();
    await stopWriter(entry);
  };

  const attach = (path: string, replica: WriterReplica): (() => Promise<void>) => {
    if (closed) { throw new Error("disk writers are closed"); }
    const entry = attachedEntry(attached, path, replica, () => {
      const created: Attached = { replica, count: 1, cancelLock: () => undefined };
      created.cancelLock = lock.request(writerLockName(libraryId, path), () => { grant(path, created); });
      return created;
    });
    return releaseOf(path, entry, drop);
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
      poller.stop();
      await Promise.all([...attached].map(([path, entry]) => drop(path, entry)));
    },
  };
}

/** The entry of a path: the one held (one replica per path, counted) or a new one made by `create`. */
function attachedEntry(attached: Map<string, Attached>, path: string, replica: WriterReplica, create: () => Attached): Attached {
  const entry = attached.get(path);
  if (!entry) {
    const created = create();
    attached.set(path, created);
    return created;
  }
  if (entry.replica !== replica) { throw new Error(`another replica is already attached to ${path}`); }
  entry.count += 1;
  return entry;
}

/** The release of one attach: the last one drops the path. */
function releaseOf(path: string, held: Attached, drop: (path: string, entry: Attached) => Promise<void>): () => Promise<void> {
  let released = false;
  return async () => {
    if (released) { return; }
    released = true;
    held.count -= 1;
    if (held.count <= 0) { await drop(path, held); }
  };
}
