// The page's live files: one LiveFiles for the current library, built from the browser adapters, replaced when the library changes.
import { createTextMerge, replicaChannelName, type LibraryFileSystem, type WriterVisibility } from "@labshelf/core";
import { showToast } from "@labshelf/core/dom";
import { diff3Merge } from "node-diff3";
import { createBrowserLogger } from "../platform";
import { createBroadcastReplicaChannel, createDocumentVisibility, createWebLockWriterLock, readHeldLockNames } from "./adapters";
import { createLiveFiles, type LiveFiles } from "./liveFiles";

const MODULE = "browser.localSync.pageLiveFiles";

const alwaysVisible: WriterVisibility = { visible: () => true, onVisible: () => () => undefined };

/** @returns a getter of the current library's LiveFiles; undefined where BroadcastChannel or Web Locks are missing. */
export function createPageLiveFiles(options: { libraryId: () => Promise<string>; fs: LibraryFileSystem; filesChanged?: (listener: (paths: readonly string[]) => void) => () => void }): () => Promise<LiveFiles | undefined> {
  const supported = typeof globalThis.BroadcastChannel === "function" && typeof navigator !== "undefined" && navigator.locks !== undefined;
  if (!supported) return () => Promise.resolve(undefined);
  const logger = createBrowserLogger();
  const textMerge = createTextMerge(diff3Merge);
  let current: LiveFiles | undefined;
  // INVARIANT: switches run one at a time, so the previous library's files close before the next one opens.
  let pending: Promise<LiveFiles> = Promise.resolve(undefined as unknown as LiveFiles);
  let listening = false;

  const build = (libraryId: string): LiveFiles => createLiveFiles({
    libraryId,
    fs: options.fs,
    channel: createBroadcastReplicaChannel(replicaChannelName(libraryId)),
    lock: createWebLockWriterLock(),
    heldLocks: () => readHeldLockNames(),
    visibility: typeof document === "undefined" ? alwaysVisible : createDocumentVisibility(),
    textMerge,
    onConflict: (path, copyPath) => { showToast(`${path} changed in another app too; your version is kept and theirs was saved as ${copyPath}`, "error"); },
    onError: (error) => { void logger.error(MODULE, error, { libraryId }); },
  });

  const forOf = async (libraryId: string): Promise<LiveFiles> => {
    if (current?.libraryId === libraryId) return current;
    const previous = current;
    current = undefined;
    if (previous) await previous.close().catch((error: unknown) => logger.error(MODULE, error, { op: "closeLiveFiles", libraryId: previous.libraryId }));
    current = build(libraryId);
    return current;
  };

  return async () => {
    if (!listening && options.filesChanged) {
      listening = true;
      options.filesChanged((paths) => { current?.changed(paths); });
    }
    const libraryId = await options.libraryId();
    const next = pending.then(() => forOf(libraryId), () => forOf(libraryId));
    pending = next;
    return next;
  };
}
