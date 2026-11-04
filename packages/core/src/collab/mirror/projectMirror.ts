// Mirrors a shared project or Space between its share docs and its folder on disk, in both directions.
import type { ConflictCopy } from "../../library/conflicts/index.js";
import type { WriteRecordStore } from "../../library/index.js";
import type * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import { readShareIndexDocFiles, readWrittenVersions, type ShareFileEntry } from "../shareIndexDoc.js";
import { type ShareBlobExchange } from "../shareBlobs.js";
import { type ShareSession } from "../docSync.js";
import type { CollabStore } from "../session/index.js";
import { DISK_ORIGIN, LOG_MODULE, reconcileShareBlob, reconcileUntracked, type MergeText, type MirrorContext, type MirrorProfile } from "./fileReconcile.js";
import { projectMirrorProfile } from "./projectProfile.js";
import { MirrorLostError } from "./projectLease.js";
import { MirrorProjectDirUnavailable, type MirrorFileSystem } from "./mirrorFileSystem.js";
import { PathQueue, type ReconcileOutcome } from "./pathQueue.js";
import { reconcileQmd, reconcileText } from "./textMirror.js";

const DEFAULT_STABLE_MS = 300;

/** Why a mirror stopped by itself: another mirror owns the folder, or the folder is gone. */
export type MirrorStopReason = MirrorLostError | MirrorProjectDirUnavailable;

export interface ProjectMirrorOptions {
  /** Names the project in logs. */
  folder: string;
  /** What the folder is; a project when absent. */
  profile?: MirrorProfile;
  disk: MirrorFileSystem;
  writeRecords: WriteRecordStore;
  mergeText: MergeText;
  session: ShareSession;
  blobs: ShareBlobExchange;
  store: CollabStore;
  logger: ILogger;
  onConflictCopy?(copy: ConflictCopy): void | Promise<void>;
  readConflictDismissals?(): Promise<readonly { path: string; hash: string }[]>;
  /** True for a path an open editor holds; the editor binding syncs it, so the mirror leaves it alone until `changed`. */
  isEditorOwned?: (path: string) => boolean;
  /** How long a changed file must stay the same before it is read. */
  stableMs?: number;
  /** Checked before the first scan and before every disk write or delete; throws MirrorLostError once another mirror owns the folder. */
  ownership?: { assertOwned(): Promise<void> };
  /** Called once when the mirror stops by itself; the share docs keep every edit, only the disk stops following them. */
  onStopped?(reason: MirrorStopReason): void;
}

export interface ProjectMirror {
  /** Reports a changed, created or deleted file by its POSIX path relative to the folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  /** Waits for queued reconciliations and disk operations; paths waiting for relay history stay deferred. */
  idle(): Promise<void>;
  /** Stops and waits for the writes in flight; close the blob exchange first, or a fetch in flight holds this open. */
  close(): Promise<void>;
}

/** Starts mirroring and reconciles every listed and every shared file once. */
export function startProjectMirror(options: ProjectMirrorOptions): ProjectMirror {
  const { folder, session, logger } = options;
  const profile = options.profile ?? projectMirrorProfile;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
  const detach: (() => void)[] = [];
  const refused = new Set<string>();
  const lifecycle = createMirrorLifecycle(options, detach, () => { void queue.close(); });
  const { guarded } = lifecycle;
  const queue = new PathQueue({ stableMs, logger, run: (path, settled) => guarded(() => reconcile(context, path, settled), "done") });
  const context: MirrorContext = {
    folder, disk: withGatedFileSystem(options.disk, lifecycle.gate), mergeText: options.mergeText, session, blobs: options.blobs, store: options.store, logger,
    conflictReports: new Map(),
    ...(options.onConflictCopy ? { onConflictCopy: options.onConflictCopy } : {}),
    ...(options.readConflictDismissals ? { readConflictDismissals: options.readConflictDismissals } : {}),
    profile, settingsBase: undefined, bases: new Map(), missingBlobs: new Set(), writeRecords: withGatedWriteRecords(options.writeRecords, lifecycle.gate, options.disk), waitingWrites: new Map(),
    request: (path, settle) => queue.request(path, settle),
    attach: (path) => attach(path),
  };
  const reconcile = reconcilePath(options.isEditorOwned ?? (() => false), refused, stableMs);

  const attach = observeDocuments(context, detach, lifecycle.isStopped);

  function changed(path: string): void {
    if (path.startsWith(".labshelf/writes/")) { context.waitingWrites.forEach((_wait, waitingPath) => queue.request(waitingPath, false)); return; }
    if (profile.diskFiles.includes(path) || profile.sharedPaths([path]).length > 0) { queue.request(path, true); }
  }

  observe(session.index, context, attach, detach);
  detach.push(session.onIndexRoundTripAvailable(() => {
    for (const [path, wait] of context.waitingWrites) {
      if (!wait.mirror) { context.waitingWrites.delete(path); context.request(path, true); }
    }
  }));
  detach.push(session.onPeer((_peer, joined) => { if (joined) { context.missingBlobs.forEach((path) => queue.request(path, false)); } }));
  if (options.disk.watch) { detach.push(options.disk.watch(changed)); }
  const firstScan = guarded(async () => { await lifecycle.gate(); await scan(context, queue); }, undefined);
  queue.track(firstScan.catch((error: unknown) => logger.error(LOG_MODULE, error, { folder, action: "first scan" })));

  return {
    changed,
    idle: () => queue.idle(),
    close: async () => {
      detach.splice(0).forEach((stop) => stop());
      await queue.close();
    },
  };
}

function observeDocuments(context: MirrorContext, detach: (() => void)[], stopped: () => boolean): (path: string) => void {
  const attached = new Set<string>();
  return (path) => {
    const kind = readShareIndexDocFiles(context.session.index).get(path)?.kind;
    if (stopped() || attached.has(path) || !context.profile.accepts(path) || (kind !== "text" && kind !== "qmd")) { return; }
    attached.add(path);
    const doc = context.session.openDoc(path);
    const onUpdate = (_update: Uint8Array, origin: unknown) => { if (origin !== DISK_ORIGIN) { context.request(path, false); } };
    doc.on("update", onUpdate);
    detach.push(() => doc.off("update", onUpdate));
  };
}

async function refuse(context: MirrorContext, path: string, refused: Set<string>): Promise<void> {
  if (refused.has(path)) { return; }
  refused.add(path);
  await context.logger.log("WARN", LOG_MODULE, "Refused a shared path that is not safe to write", { folder: context.folder, path });
}

/** Reconciles one path: refuses paths the folder may not hold, and leaves editor-owned ones alone. */
function reconcilePath(isEditorOwned: (path: string) => boolean, refused: Set<string>, stableMs: number) {
  return async (context: MirrorContext, path: string, settled: boolean): Promise<ReconcileOutcome> => {
    const { profile } = context;
    if (profile.ownFiles.includes(path)) {
      // The index, not a peer's file entry, writes an own file; an entry naming one is refused all the same.
      if (readShareIndexDocFiles(context.session.index).has(path)) { await refuse(context, path, refused); }
      return profile.reconcile(context, path, settled, stableMs);
    }
    if (!profile.accepts(path)) { await refuse(context, path, refused); return "done"; }
    const disk = await context.disk.read(path, settled ? stableMs : undefined);
    if (isEditorOwned(path)) { return "done"; }
    const entry = readShareIndexDocFiles(context.session.index).get(path);
    if (!entry) { return reconcileUntracked(context, path, disk, settled); }
    if (entry.kind === "qmd") { return reconcileQmd(context, path, disk, settled); }
    return entry.kind === "text" ? reconcileText(context, path, disk, settled) : reconcileShareBlob(context, path, entry, disk, settled);
  };
}

/** Index edits reach disk: a listed, changed or removed file is reconciled, new text docs are listened to, and comments.qmd follows the map. */
function observe(index: Y.Doc, context: MirrorContext, attach: (path: string) => void, detach: (() => void)[]): void {
  const files = readShareIndexDocFiles(index);
  const onFiles = (event: Y.YMapEvent<ShareFileEntry>) => {
    for (const path of event.keysChanged) {
      attach(path);
      if (event.transaction.origin !== DISK_ORIGIN) { context.request(path, false); }
    }
  };
  files.observe(onFiles);
  const written = readWrittenVersions(index);
  const onWritten = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    for (const event of events) {
      if (event.target === written) {
        for (const path of (event as Y.YMapEvent<unknown>).keysChanged) { context.request(path, false); }
      } else if (typeof event.path[0] === "string") { context.request(event.path[0], false); }
    }
  };
  written.observeDeep(onWritten);
  detach.push(() => written.unobserveDeep(onWritten));
  detach.push(() => files.unobserve(onFiles), context.profile.observe(index, (path) => context.request(path, false)));
}

async function scan(context: MirrorContext, queue: PathQueue): Promise<void> {
  const onDisk = await context.disk.list();
  const listed = [...readShareIndexDocFiles(context.session.index).keys()];
  listed.forEach((path) => context.attach(path));
  const paths = new Set([...context.profile.ownFiles, ...listed, ...context.profile.sharedPaths(onDisk)]);
  paths.forEach((path) => queue.request(path, false));
  await context.logger.log("INFO", LOG_MODULE, "Started mirroring a shared folder", { folder: context.folder, listed: listed.length, onDisk: onDisk.length });
}

function createMirrorLifecycle(options: ProjectMirrorOptions, detach: (() => void)[], stopQueue: () => void) {
  let stopped: MirrorStopReason | undefined;
  const gate = async () => {
    if (stopped) { throw stopped; }
    await options.ownership?.assertOwned();
  };
  async function guarded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try { return await work(); } catch (error) {
      if (!(error instanceof MirrorLostError) && !(error instanceof MirrorProjectDirUnavailable)) { throw error; }
      if (!stopped) {
        stopped = error;
        detach.splice(0).forEach((stop) => stop());
        // TRAP: The queue cannot await its own running reconcile.
        stopQueue();
        void options.logger.log("WARN", LOG_MODULE, "Stopped mirroring a shared project", { folder: options.folder, reason: error.name, message: error.message });
        options.onStopped?.(error);
      }
      return fallback;
    }
  }
  return { gate, guarded, isStopped: () => stopped !== undefined };
}

function withGatedFileSystem(disk: MirrorFileSystem, gate: () => Promise<void>): MirrorFileSystem {
  return {
    read: (path, stableMs) => disk.read(path, stableMs),
    write: async (path, bytes) => { await gate(); await disk.write(path, bytes); },
    remove: async (path) => { await gate(); await disk.remove(path); },
    list: () => disk.list(),
  };
}

function withGatedWriteRecords(records: WriteRecordStore, gate: () => Promise<void>, disk: MirrorFileSystem): WriteRecordStore {
  return {
    read: () => records.read(),
    append: async (entry) => { await gate(); await disk.list(); await records.append(entry); },
  };
}
