// A page's live files of one library: a replica per open file, kept in step with the other pages, and the disk writers
// that persist the files whose lock this page holds.
import {
  createDiskWriters, createReplicaHub, deriveReplicaKind, writerLockName,
  type LibraryFileSystem, type Replica, type ReplicaChannel, type SessionScheduler, type TextMerge, type WriterLock, type WriterVisibility,
} from "@labshelf/core";
import { createLibraryWriterFiles } from "./adapters";

interface LiveFile { readonly replica: Replica; flush(): Promise<void>; release(): Promise<void> }

export interface LiveFiles { readonly libraryId: string; open(path: string): LiveFile; isLive(path: string): Promise<boolean>; write(path: string, text: string): Promise<boolean>; read(path: string): Promise<string | undefined>; changed(paths: readonly string[]): void; close(): Promise<void> }

export interface LiveFilesOptions { libraryId: string; fs: LibraryFileSystem; channel: ReplicaChannel & { close(): void }; lock: WriterLock; heldLocks: () => Promise<readonly string[]>; visibility: WriterVisibility; textMerge: TextMerge; onConflict: (path: string, copyPath: string) => void; onError: (error: unknown) => void; scheduler?: SessionScheduler; peerWaitMs?: number; pollMs?: number; persistDelayMs?: number }

// CONTRACT: documents/contracts/local-sync.md#hosts
/** `fs` is the unwrapped library file system: the replicas read it and the writers write it, never through a replica. */
export function createLiveFiles(options: LiveFilesOptions): LiveFiles {
  const { libraryId, fs, channel } = options;
  const timing = {
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
    ...(options.pollMs !== undefined ? { pollMs: options.pollMs } : {}),
    ...(options.persistDelayMs !== undefined ? { persistDelayMs: options.persistDelayMs } : {}),
  };
  const hub = createReplicaHub({
    channel, ...(options.scheduler ? { scheduler: options.scheduler } : {}), ...(options.peerWaitMs !== undefined ? { peerWaitMs: options.peerWaitMs } : {}),
  });
  // No observer: the writers poll the disk every 2 s while the page is visible.
  const writers = createDiskWriters({
    libraryId, files: createLibraryWriterFiles(fs), lock: options.lock, visibility: options.visibility, textMerge: options.textMerge,
    onConflict: options.onConflict, onError: options.onError, ...timing,
  });
  // Replicas this page holds, counted per path (open, write and read each hold one while they run).
  const held = new Map<string, number>();
  const hold = (path: string): Replica => {
    held.set(path, (held.get(path) ?? 0) + 1);
    return hub.open(path, deriveReplicaKind(path), () => fs.readText(path));
  };
  const unhold = (path: string, replica: Replica): void => {
    replica.release();
    const count = (held.get(path) ?? 1) - 1;
    if (count > 0) held.set(path, count); else held.delete(path);
  };

  const isLive = async (path: string): Promise<boolean> => {
    if (held.has(path)) return true;
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
      let released: Promise<void> | undefined;
      // INVARIANT: the writer attaches once the replica holds the file's text, else it would persist the empty doc over the disk.
      const attached = replica.ready.then(
        () => (released ? undefined : writers.attach(path, replica)),
        (error: unknown) => { options.onError(error); return undefined; },
      );
      return {
        replica,
        flush: async () => { if (await attached) await writers.flush(path); },
        release: () => (released ??= attached.then((detach) => detach?.()).finally(() => { unhold(path, replica); })),
      };
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
