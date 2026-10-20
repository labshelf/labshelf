// Mirrors a shared project between its share docs and its folder on disk, in both directions.
import type * as Y from "yjs";
import type { ILogger } from "../../ports/index.js";
import { PROJECT_FILE } from "../../writing/project/index.js";
import { indexFiles, indexSettings, isSafeSharePath, sharedPaths, type ShareFileEntry } from "../model/index.js";
import { MirrorOwnershipLost } from "../ownership/index.js";
import type { BlobExchange, ShareSession } from "../sync/index.js";
import type { CollabStore } from "../state/index.js";
import { MirrorRootUnavailable, type MirrorDisk } from "./disk/index.js";
import {
  DISK_ORIGIN, LOG_MODULE, PathQueue, reconcileBlob, reconcileSettings, reconcileText, reconcileUntracked,
  type MergeText, type MirrorContext, type ReconcileOutcome,
} from "./reconcile/index.js";

const DEFAULT_STABLE_MS = 300;

/** Why a mirror stopped by itself: another mirror owns the folder, or the folder is gone. */
export type MirrorStopReason = MirrorOwnershipLost | MirrorRootUnavailable;

export interface ProjectMirrorOptions {
  /** Names the project in logs. */
  folder: string;
  disk: MirrorDisk;
  mergeText: MergeText;
  session: ShareSession;
  blobs: BlobExchange;
  store: CollabStore;
  logger: ILogger;
  /** True for a path an open editor holds; the editor binding syncs it, so the mirror leaves it alone until `changed`. */
  isEditorOwned?: (path: string) => boolean;
  /** How long a changed file must stay the same before it is read. */
  stableMs?: number;
  /** Checked before the first scan and before every disk write or delete; throws MirrorOwnershipLost once another mirror owns the folder. */
  ownership?: { assertOwned(): Promise<void> };
  /** Called once when the mirror stops by itself; the share docs keep every edit, only the disk stops following them. */
  onStopped?(reason: MirrorStopReason): void;
}

export interface ProjectMirror {
  /** Reports a changed, created or deleted file by its POSIX path relative to the folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  /** Resolves when no change is waiting or being applied. */
  idle(): Promise<void>;
  /** Stops and waits for the writes in flight; close the blob exchange first, or a fetch in flight holds this open. */
  close(): Promise<void>;
}

const isStopReason = (error: unknown): error is MirrorStopReason =>
  error instanceof MirrorOwnershipLost || error instanceof MirrorRootUnavailable;

/** The disk with every write and delete behind `gate`, so a stopped or displaced mirror cannot change the folder. */
function gateDisk(disk: MirrorDisk, gate: () => Promise<void>): MirrorDisk {
  return {
    read: (path, stableMs) => disk.read(path, stableMs),
    write: async (path, bytes) => { await gate(); await disk.write(path, bytes); },
    remove: async (path) => { await gate(); await disk.remove(path); },
    list: () => disk.list(),
  };
}

/** Starts mirroring and reconciles every listed and every shared file once. */
export function startProjectMirror(options: ProjectMirrorOptions): ProjectMirror {
  const { folder, session, logger } = options;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
  const detach: (() => void)[] = [];
  const stopListeners = () => detach.splice(0).forEach((stop) => stop());
  const attached = new Set<string>();
  const refused = new Set<string>();
  let stopped: MirrorStopReason | undefined;
  const gate = async () => {
    if (stopped) { throw stopped; }
    await options.ownership?.assertOwned();
  };
  const queue = new PathQueue({ stableMs, logger, run: (path, settled) => guarded(() => reconcile(context, path, settled), "done") });
  const context: MirrorContext = {
    folder, disk: gateDisk(options.disk, gate), mergeText: options.mergeText, session, blobs: options.blobs, store: options.store, logger,
    bases: new Map(), settingsBase: undefined, missingBlobs: new Set(),
    request: (path, settle) => queue.request(path, settle),
    attach: (path) => attach(path),
  };
  const reconcile = reconcilePath(options.isEditorOwned ?? (() => false), refused, stableMs);

  function stop(reason: MirrorStopReason): void {
    if (stopped) { return; }
    stopped = reason;
    stopListeners();
    // TRAP: awaiting here would wait for the very run that called this, inside the queue.
    void queue.close();
    void logger.log("WARN", LOG_MODULE, "Stopped mirroring a shared project", { folder, reason: reason.name, message: reason.message });
    options.onStopped?.(reason);
  }

  async function guarded<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!isStopReason(error)) { throw error; }
      stop(error);
      return fallback;
    }
  }

  function attach(path: string): void {
    if (stopped || attached.has(path) || !isSafeSharePath(path) || indexFiles(session.index).get(path)?.kind !== "text") { return; }
    attached.add(path);
    const doc = session.openDoc(path);
    const onUpdate = (_update: Uint8Array, origin: unknown) => { if (origin !== DISK_ORIGIN) { queue.request(path, false); } };
    doc.on("update", onUpdate);
    detach.push(() => doc.off("update", onUpdate));
  }

  function changed(path: string): void {
    if (path === PROJECT_FILE || sharedPaths([path]).length > 0) { queue.request(path, true); }
  }

  observe(session.index, context, attach, detach);
  detach.push(session.onPeer((_peer, joined) => { if (joined) { context.missingBlobs.forEach((path) => queue.request(path, false)); } }));
  if (options.disk.watch) { detach.push(options.disk.watch(changed)); }
  const firstScan = guarded(async () => { await gate(); await scan(context, queue); }, undefined);
  queue.track(firstScan.catch((error: unknown) => logger.error(LOG_MODULE, error, { folder, action: "first scan" })));

  return {
    changed,
    idle: () => queue.idle(),
    close: async () => {
      stopListeners();
      await queue.close();
    },
  };
}

/** Reconciles one path: refuses unsafe paths, and leaves editor-owned ones alone. */
function reconcilePath(isEditorOwned: (path: string) => boolean, refused: Set<string>, stableMs: number) {
  return async (context: MirrorContext, path: string, settled: boolean): Promise<ReconcileOutcome> => {
    if (path !== PROJECT_FILE && !isSafeSharePath(path)) {
      if (refused.has(path)) { return "done"; }
      refused.add(path);
      await context.logger.log("WARN", LOG_MODULE, "Refused a shared path that is not safe to write", { folder: context.folder, path });
      return "done";
    }
    const disk = await context.disk.read(path, settled ? stableMs : undefined);
    if (path === PROJECT_FILE) { return reconcileSettings(context, disk, settled); }
    if (isEditorOwned(path)) { return "done"; }
    const entry = indexFiles(context.session.index).get(path);
    if (!entry) { return reconcileUntracked(context, path, disk, settled); }
    return entry.kind === "text" ? reconcileText(context, path, disk, settled) : reconcileBlob(context, path, entry, disk, settled);
  };
}

/** Index edits from peers reach disk: a listed, changed or removed file is reconciled, and new text docs are listened to. */
function observe(index: Y.Doc, context: MirrorContext, attach: (path: string) => void, detach: (() => void)[]): void {
  const files = indexFiles(index);
  const onFiles = (event: Y.YMapEvent<ShareFileEntry>) => {
    for (const path of event.keysChanged) {
      attach(path);
      if (event.transaction.origin !== DISK_ORIGIN) { context.request(path, false); }
    }
  };
  files.observe(onFiles);
  const settings = indexSettings(index);
  const onSettings = (event: Y.YMapEvent<unknown>) => {
    if (event.transaction.origin !== DISK_ORIGIN) { context.request(PROJECT_FILE, false); }
  };
  settings.observe(onSettings);
  detach.push(() => files.unobserve(onFiles), () => settings.unobserve(onSettings));
}

async function scan(context: MirrorContext, queue: PathQueue): Promise<void> {
  const onDisk = await context.disk.list();
  const listed = [...indexFiles(context.session.index).keys()];
  listed.forEach((path) => context.attach(path));
  const paths = new Set([PROJECT_FILE, ...listed, ...sharedPaths(onDisk)]);
  paths.forEach((path) => queue.request(path, false));
  await context.logger.log("INFO", LOG_MODULE, "Started mirroring a shared project", { folder: context.folder, listed: listed.length, onDisk: onDisk.length });
}
