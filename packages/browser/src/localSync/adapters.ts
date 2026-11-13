// The browser's ports for local sync: the replica channel over a BroadcastChannel, the writer lock over Web Locks, the
// held-lock query, document visibility and the writer's file calls over the LibraryFileSystem.
import { isAbortError, type FileStat, type LibraryFileSystem, type ReplicaChannel, type ReplicaMessage, type WriterFiles, type WriterLock, type WriterVisibility } from "@labshelf/core";

type MessageListener = (event: MessageEvent) => void;

function parseReplicaMessage(data: unknown): ReplicaMessage | undefined {
  if (data === null || typeof data !== "object") return undefined;
  const { key, from, to, bytes } = data as Record<string, unknown>;
  if (typeof key !== "string" || typeof from !== "string" || !(bytes instanceof Uint8Array)) return undefined;
  if (to !== undefined && typeof to !== "string") return undefined;
  return to === undefined ? { key, from, bytes } : { key, from, to, bytes };
}

/** One long-lived BroadcastChannel for a library's replicas; listeners get well-formed messages only, none after close. */
export function createBroadcastReplicaChannel(name: string, create: (name: string) => BroadcastChannel = (n) => new BroadcastChannel(n)): ReplicaChannel & { close(): void } {
  const channel = create(name);
  const listeners = new Set<(message: ReplicaMessage) => void>();
  const onMessage: MessageListener = (event) => {
    const message = parseReplicaMessage(event.data);
    if (!message) return;
    for (const listener of [...listeners]) listener(message);
  };
  channel.addEventListener("message", onMessage);
  return {
    // PLATFORM: structured clone keeps a Uint8Array a Uint8Array.
    post: (message) => {
      channel.postMessage(message.to === undefined ? { key: message.key, from: message.from, bytes: message.bytes } : { key: message.key, from: message.from, to: message.to, bytes: message.bytes });
    },
    onMessage: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    close: () => {
      listeners.clear();
      channel.removeEventListener("message", onMessage);
      channel.close();
    },
  };
}

// INVARIANT: the lock is held while the request callback's promise is pending; cancel resolves it or aborts the wait.
/** An exclusive Web Lock per name, held from the grant until the returned cancel. */
export function createWebLockWriterLock(locks?: LockManager): WriterLock {
  return {
    request: (name, onGranted) => {
      const manager = locks ?? navigator.locks;
      const abort = new AbortController();
      let cancelled = false;
      let releaseHeld: () => void = () => {};
      const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
      manager.request(name, { mode: "exclusive", signal: abort.signal }, async () => {
        if (cancelled) return;
        onGranted();
        await held;
      }).catch((error: unknown) => {
        if (!isAbortError(error)) throw error;
      });
      return () => {
        if (cancelled) return;
        cancelled = true;
        abort.abort();
        releaseHeld();
      };
    },
  };
}

/** The names of the locks held or waited for in this browser profile. */
export async function readHeldLockNames(locks?: LockManager): Promise<readonly string[]> {
  const snapshot = await (locks ?? navigator.locks).query();
  const names = [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].map((info) => info.name).filter((name): name is string => typeof name === "string");
  return [...new Set(names)];
}

/** Visible while the document is; becoming visible or the window gaining focus calls the listeners. */
export function createDocumentVisibility(doc: Document = document, win: Window = window): WriterVisibility {
  return {
    visible: () => doc.visibilityState === "visible",
    onVisible: (listener) => {
      const onChange = (): void => { if (doc.visibilityState === "visible") listener(); };
      const onFocus = (): void => { listener(); };
      doc.addEventListener("visibilitychange", onChange);
      win.addEventListener("focus", onFocus);
      return () => {
        doc.removeEventListener("visibilitychange", onChange);
        win.removeEventListener("focus", onFocus);
      };
    },
  };
}

/** The writer's file calls over the library file system; a missing file fails the stat. */
export function createLibraryWriterFiles(fs: LibraryFileSystem): WriterFiles {
  return {
    read: (path) => fs.readText(path),
    write: (path, text) => fs.writeText(path, text),
    stat: async (path): Promise<FileStat> => {
      const stat = await fs.stat(path);
      if (!stat) throw new Error(`The file ${path} does not exist`);
      return { lastModified: stat.mtimeMs, size: stat.size };
    },
  };
}
