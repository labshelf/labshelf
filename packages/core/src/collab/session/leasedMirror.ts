// Starts a share connection's disk mirror only while this app holds the project folder's lease, waiting for a busy folder to free.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import type { ConflictCopy, ConflictDismissal } from "../../library/conflicts/index.js";
import type { ILogger, LibraryFileSystem } from "../../ports/index.js";
import { createWriteRecordStore, type DeviceIdentity } from "../../library/writeRecords/index.js";
import { startProjectMirror, type MergeText, type MirrorDisk } from "../mirror/index.js";
import { acquireFolderLease, systemLeaseScheduler, type FolderLease, type LeaseScheduler, type MirrorApp } from "../ownership/index.js";
import type { ConnectionMirror, MirrorFactory, MirrorInput } from "./connectionMirror.js";

const LOG_MODULE = "collab.mirror.lease";
// Half the lease renewal interval, so a dead owner's folder is taken within about 35 s of its last renewal.
const RETRY_MS = 5_000;

export interface LeasedMirrorOptions {
  /** The file port the folder paths the connection reports resolve on. */
  fs: LibraryFileSystem;
  identity: DeviceIdentity;
  app: MirrorApp;
  logger: ILogger;
  mergeText: MergeText;
  disk(folder: string): MirrorDisk;
  /** True for a path an open editor holds; the editor binding syncs it. */
  isEditorOwned?(folder: string, path: string): boolean;
  onConflictCopy?(folder: string, copy: ConflictCopy): void | Promise<void>;
  readConflictDismissals?(folder: string): Promise<readonly ConflictDismissal[]>;
  scheduler?: LeaseScheduler;
}

export function leasedMirrorFactory(options: LeasedMirrorOptions): MirrorFactory {
  const scheduler = options.scheduler ?? systemLeaseScheduler;
  const acquire = (folder: string) => acquireFolderLease({ fs: options.fs, folder, app: options.app, logger: options.logger, scheduler });
  return async (input) => {
    const first = await acquire(input.folder);
    if (first.kind === "owned") { return { kind: "running", mirror: runMirror(options, input, first.lease) }; }
    void options.logger.log("INFO", LOG_MODULE, "Another mirror owns the shared project folder; waiting for it to free", {
      folder: input.folder, holder: first.holder,
    });
    const lease = waitForLease(() => acquire(input.folder), input.signal, scheduler, options.logger, input.folder);
    return { kind: "busy", holder: first.holder, running: lease.then((held) => held && runMirror(options, input, held)) };
  };
}

/** Retries the lease until it is ours; undefined once `signal` aborts, with any lease taken meanwhile released. */
function waitForLease(
  acquire: () => ReturnType<typeof acquireFolderLease>, signal: AbortSignal, scheduler: LeaseScheduler, logger: ILogger, folder: string,
): Promise<FolderLease | undefined> {
  return new Promise((resolve) => {
    let trying = false;
    const finish = (lease: FolderLease | undefined): void => { stop(); signal.removeEventListener("abort", onAbort); resolve(lease); };
    const onAbort = (): void => { if (!trying) { finish(undefined); } };
    const stop = scheduler.every(RETRY_MS, () => {
      if (trying || signal.aborted) { return; }
      trying = true;
      acquire().then(async (result) => {
        trying = false;
        if (signal.aborted) {
          if (result.kind === "owned") { await result.lease.release(); }
          finish(undefined);
        } else if (result.kind === "owned") {
          finish(result.lease);
        }
      }).catch((error: unknown) => {
        trying = false;
        void logger.error(LOG_MODULE, error, { folder, op: "retryMirrorLease" });
        if (signal.aborted) { finish(undefined); }
      });
    });
    signal.addEventListener("abort", onAbort);
  });
}

function runMirror(options: LeasedMirrorOptions, input: MirrorInput, lease: FolderLease): ConnectionMirror {
  const { folder } = input;
  const { logger } = options;
  void logger.log("INFO", LOG_MODULE, "Mirroring the shared project folder", { folder, app: options.app });
  let closing: Promise<void> | undefined;
  const isEditorOwned = options.isEditorOwned;
  const mirror = startProjectMirror({
    folder, disk: options.disk(folder), mergeText: options.mergeText, session: input.session, blobs: input.blobs, store: input.store, logger,
    ownership: lease, onStopped: (reason) => stop(reason.message),
    writeRecords: createWriteRecordStore(options.fs, folder, options.identity, logger),
    ...(options.onConflictCopy ? { onConflictCopy: (copy: ConflictCopy) => options.onConflictCopy!(folder, copy) } : {}),
    ...(options.readConflictDismissals ? { readConflictDismissals: () => options.readConflictDismissals!(folder) } : {}),
    ...(isEditorOwned ? { isEditorOwned: (path: string) => isEditorOwned(folder, path) } : {}),
  });
  const close = (): Promise<void> => (closing ??= (async () => {
    const released = lease.release().catch((error: unknown) => { void logger.error(LOG_MODULE, error, { folder, op: "releaseMirrorLease" }); });
    await Promise.all([mirror.close(), released]);
  })());
  function stop(reason: string): void {
    if (closing) { return; }
    void logger.log("WARN", LOG_MODULE, "The shared project mirror stopped writing to disk", { folder, reason });
    void close();
    input.onStopped(reason);
  }
  lease.onLost((error) => stop(error.message));
  return { changed: (path) => mirror.changed(path), idle: () => mirror.idle(), close };
}
