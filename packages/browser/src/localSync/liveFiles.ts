// A page's live files of one library: a replica per open file, kept in step with the other pages, and the disk writers
// that persist the files whose lock this page holds.
import {
  createDiskWriters, createReplicaHub, deriveReplicaKind, systemScheduler, writerLockName,
  type LibraryFileSystem, type Replica, type ReplicaChannel, type SessionScheduler, type TextMerge, type WriterLock, type WriterVisibility,
} from "@labshelf/core";
import { createLibraryWriterFiles } from "./adapters";

type DiskWriters = ReturnType<typeof createDiskWriters>;
type ReplicaHub = ReturnType<typeof createReplicaHub>;

interface LiveFile { readonly replica: Replica; flush(): Promise<void>; release(): Promise<void> }

export interface LiveFiles { readonly libraryId: string; open(path: string): LiveFile; isLive(path: string): Promise<boolean>; write(path: string, text: string): Promise<boolean>; read(path: string): Promise<string | undefined>; changed(paths: readonly string[]): void; close(): Promise<void> }

export interface LiveFilesOptions { libraryId: string; fs: LibraryFileSystem; channel: ReplicaChannel & { close(): void }; lock: WriterLock; heldLocks: () => Promise<readonly string[]>; visibility: WriterVisibility; textMerge: TextMerge; onConflict: (path: string, copyPath: string) => void; onError: (error: unknown) => void; scheduler?: SessionScheduler; peerWaitMs?: number; pollMs?: number; persistDelayMs?: number }

/** Replicas this page holds, counted per path (open, write and read each hold one while they run). */
function createHolds(hub: ReplicaHub, fs: LibraryFileSystem): { hold(path: string): Replica; unhold(path: string, replica: Replica): void; has(path: string): boolean } {
  const held = new Map<string, number>();
  return {
    hold: (path) => {
      held.set(path, (held.get(path) ?? 0) + 1);
      return hub.open(path, deriveReplicaKind(path), () => fs.readText(path));
    },
    unhold: (path, replica) => {
      replica.release();
      const count = (held.get(path) ?? 1) - 1;
      if (count > 0) held.set(path, count); else held.delete(path);
    },
    has: (path) => held.has(path),
  };
}

function openLiveFile(path: string, replica: Replica, writers: DiskWriters, onError: (error: unknown) => void, unhold: () => void): LiveFile {
  let released: Promise<void> | undefined;
  // INVARIANT: the writer attaches once the replica holds the file's text, else it would persist the empty doc over the disk.
  const attached = replica.ready.then(
    () => (released ? undefined : writers.attach(path, replica)),
    (error: unknown) => { onError(error); return undefined; },
  );
  return {
    replica,
    flush: async () => { if (await attached) await writers.flush(path); },
    release: () => (released ??= attached.then((detach) => detach?.()).finally(unhold)),
  };
}

function createWriters(options: LiveFilesOptions): DiskWriters {
  const timing = {
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
    ...(options.persistDelayMs !== undefined ? { persistDelayMs: options.persistDelayMs } : {}),
  };
  // No observer: the writers poll the disk every 2 s while the page is visible.
  return createDiskWriters({
    libraryId: options.libraryId, files: createLibraryWriterFiles(options.fs), lock: options.lock, visibility: options.visibility, textMerge: options.textMerge,
    onConflict: options.onConflict, onError: options.onError, ...timing,
  });
}

// CONTRACT: documents/contracts/local-sync.md#hosts
/** `fs` is the unwrapped library file system: the replicas read it and the writers write it, never through a replica. */
export function createLiveFiles(options: LiveFilesOptions): LiveFiles {
  const { libraryId, fs, channel } = options;
  const hub = createReplicaHub({
    channel, ...(options.scheduler ? { scheduler: options.scheduler } : {}), ...(options.peerWaitMs !== undefined ? { peerWaitMs: options.peerWaitMs } : {}),
  });
  const writers = createWriters(options);
  const { hold, unhold, has } = createHolds(hub, fs);

  const isLive = async (path: string): Promise<boolean> => {
    if (has(path)) return true;
    return (await options.heldLocks()).includes(writerLockName(libraryId, path));
  };

  /** Runs `use` on a replica of a live path, opened without a writer; undefined when the path is not live or the replica fails. */
  const withReplica = async <T>(path: string, use: (replica: Replica) => T): Promise<T | undefined> => {
    if (!(await isLive(path))) return undefined;
    const replica = hold(path);
    try {
      await replica.ready;
      return use(replica);
    } catch {
      return undefined;
    } finally {
      unhold(path, replica);
    }
  };

  return {
    libraryId,
    open: (path) => {
      const replica = hold(path);
      return openLiveFile(path, replica, writers, options.onError, () => unhold(path, replica));
    },
    isLive,
    write: async (path, text) => (await withReplica(path, (replica) => { replica.replace(text); return true; })) ?? false,
    read: (path) => withReplica(path, (replica) => replica.text()),
    changed: (paths) => { for (const path of paths) writers.changed(path); },
    close: async () => {
      await writers.close();
      hub.close();
      channel.close();
    },
  };
}

const DEFAULT_DELAY_MS = 100;

/**
 * Opens `path` in the page's live files and holds it until `release`; once the replica is ready, calls `onChange` once
 * `delayMs` after the last of a burst of doc updates. A replica that fails to become ready reports nothing.
 * @returns release, which flushes the file, then releases it, and cancels a pending `onChange`.
 */
export function followLiveNotes(options: { live: LiveFiles; path: string; onChange: () => void; delayMs?: number; scheduler?: SessionScheduler }): { release(): Promise<void> } {
  const { onChange } = options;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;
  const scheduler = options.scheduler ?? systemScheduler;
  const file = options.live.open(options.path);
  let stopped = false;
  let cancelPending: (() => void) | undefined;
  let unsubscribe: (() => void) | undefined;

  const onUpdate = (): void => {
    cancelPending?.();
    cancelPending = scheduler.after(delayMs, () => { cancelPending = undefined; if (!stopped) onChange(); });
  };
  // INVARIANT: the subscription starts after ready, so the text the replica starts from is not reported as a change.
  void file.replica.ready.then(
    () => {
      if (stopped) return;
      file.replica.doc.on("update", onUpdate);
      unsubscribe = () => file.replica.doc.off("update", onUpdate);
    },
    () => undefined,
  );

  let released: Promise<void> | undefined;
  return {
    release: () => (released ??= (async () => {
      stopped = true;
      cancelPending?.();
      cancelPending = undefined;
      unsubscribe?.();
      await file.flush();
      await file.release();
    })()),
  };
}
