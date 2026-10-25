// Mirrors a shared project between its share docs and its folder on disk, in both directions.
import type { ConflictCopy } from "../../library/conflicts/index.js";
import type { WriteRecordStore } from "../../library/writeRecords/index.js";
import type * as Y from "yjs";
import { COMMENTS_PATH, renderCommentsFile } from "../comments/index.js";
import type { ILogger } from "../../ports/index.js";
import { PROJECT_FILE } from "../../writing/project/index.js";
import {
  readShareIndexDocComments,
  readShareIndexDocFiles,
  readShareIndexDocSettings,
  readWrittenVersions,
  isSafeSharePath,
  deriveSharedPaths,
  type ShareFileEntry,
  applySharedSettings,
  readSettingsMap,
  parseSharedSettings,
  writeSettingsChanges,
  writeSettingsMap,
} from "../model/index.js";
import type { MirrorLostError } from "./MirrorLostError.js";
import type { ShareBlobExchange, ShareSession } from "../doc/index.js";
import type { CollabStore } from "../deviceState/index.js";
import type { MirrorProjectDirUnavailable, MirrorFileSystem, MirrorFileRead } from "./fileSystem/index.js";
import { createMirrorLifecycle, withGatedFileSystem, withGatedWriteRecords } from "./mirrorLifecycle.js";
import { DISK_ORIGIN, LOG_MODULE, type MergeText, type MirrorContext, deriveMirrorHash, writeMirrored } from "./mirrorContext.js";
import { PathQueue, type ReconcileOutcome } from "./pathQueue.js";
import { reconcileShareBlob } from "./reconcileShareBlob.js";
import { reconcileText } from "./textMirror.js";
import { reconcileUntracked } from "./untrackedFile.js";

async function reconcileComments(context: MirrorContext, disk: MirrorFileRead): Promise<ReconcileOutcome> {
  if (disk.state === "changing") { return "changing"; }
  const existing = disk.state === "present" ? new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes) : undefined;
  const rendered = renderCommentsFile(context.session.index, existing);
  if (rendered === undefined) {
    await context.logger.log("WARN", LOG_MODULE, "Kept a comments.json that is not valid; fix or delete it to save the shared threads there", {
      folder: context.folder, path: COMMENTS_PATH,
    });
    return "done";
  }
  // An empty map writes no file into a project that has none.
  if (rendered === existing || (existing === undefined && readShareIndexDocComments(context.session.index).size === 0)) { return "done"; }
  await context.disk.write(COMMENTS_PATH, new TextEncoder().encode(rendered));
  await context.logger.log("INFO", LOG_MODULE, "Wrote the shared comment threads to comments.json", { folder: context.folder });
  return "done";
}

async function reconcileSettings(context: MirrorContext, disk: MirrorFileRead, settled: boolean): Promise<ReconcileOutcome> {
  const { session, store, logger } = context;
  if (disk.state === "changing") { return "changing"; }
  if (disk.state === "missing") {
    await logger.log("WARN", LOG_MODULE, "The shared project has no labshelf.yaml; settings not mirrored", { folder: context.folder });
    return "done";
  }
  const yaml = new TextDecoder("utf-8", { ignoreBOM: true }).decode(disk.bytes);
  const diskHash = await deriveMirrorHash(yaml);
  const known = store.known.get(PROJECT_FILE);
  const map = readShareIndexDocSettings(session.index);
  try {
    // A first look takes the share's settings when it has any, so a fresh copy never clears them.
    if (diskHash === known || (known === undefined && map.size > 0)) {
      await writeFromShare(context, yaml, diskHash);
      return "done";
    }
    if (!settled) { context.request(PROJECT_FILE, true); return "done"; }
    const shared = parseSharedSettings(yaml);
    const base = context.settingsBase;
    // With no base (first look, or an edit made while LabShelf was closed) the file's shared keys are taken whole.
    session.index.transact(() => (base ? writeSettingsChanges(map, shared, base) : writeSettingsMap(map, shared)), DISK_ORIGIN);
    await logger.log("INFO", LOG_MODULE, "Took labshelf.yaml edits into the shared settings", { folder: context.folder, keys: Object.keys(shared) });
    await writeFromShare(context, yaml, diskHash);
  } catch (error) {
    await logger.log("WARN", LOG_MODULE, "Left labshelf.yaml out of the share until it is valid", { folder: context.folder, error: String(error) });
  }
  return "done";
}

/** Writes the index's settings into the file, keeping its own keys, and records them as the agreed base. */
async function writeFromShare(context: MirrorContext, yaml: string, diskHash: string): Promise<void> {
  const settings = readSettingsMap(readShareIndexDocSettings(context.session.index));
  const next = applySharedSettings(yaml, settings);
  if (next === yaml) { context.store.known.set(PROJECT_FILE, diskHash); } else { await writeMirrored(context, PROJECT_FILE, next); }
  context.settingsBase = settings;
}

const DEFAULT_STABLE_MS = 300;

/** Why a mirror stopped by itself: another mirror owns the folder, or the folder is gone. */
export type MirrorStopReason = MirrorLostError | MirrorProjectDirUnavailable;

export interface ProjectMirrorOptions {
  /** Names the project in logs. */
  folder: string;
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
    settingsBase: undefined, missingBlobs: new Set(), writeRecords: withGatedWriteRecords(options.writeRecords, lifecycle.gate, options.disk), waitingWrites: new Map(),
    request: (path, settle) => queue.request(path, settle),
    attach: (path) => attach(path),
  };
  const reconcile = reconcilePath(options.isEditorOwned ?? (() => false), refused, stableMs);

  const attach = observeDocuments(context, detach, lifecycle.isStopped);

  function changed(path: string): void {
    if (path.startsWith(".labshelf/writes/")) { context.waitingWrites.forEach((_wait, waitingPath) => queue.request(waitingPath, false)); return; }
    if (path === PROJECT_FILE || deriveSharedPaths([path]).length > 0) { queue.request(path, true); }
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
    if (stopped() || attached.has(path) || !isSafeSharePath(path) || readShareIndexDocFiles(context.session.index).get(path)?.kind !== "text") { return; }
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

/** Reconciles one path: refuses unsafe paths, and leaves editor-owned ones alone. */
function reconcilePath(isEditorOwned: (path: string) => boolean, refused: Set<string>, stableMs: number) {
  return async (context: MirrorContext, path: string, settled: boolean): Promise<ReconcileOutcome> => {
    if (path !== PROJECT_FILE && !isSafeSharePath(path)) {
      // The comments map, not a peer's file entry, writes comments.json; an entry naming it is refused all the same.
      if (path !== COMMENTS_PATH || readShareIndexDocFiles(context.session.index).has(path)) { await refuse(context, path, refused); }
      if (path !== COMMENTS_PATH) { return "done"; }
      return reconcileComments(context, await context.disk.read(path));
    }
    const disk = await context.disk.read(path, settled ? stableMs : undefined);
    if (path === PROJECT_FILE) { return reconcileSettings(context, disk, settled); }
    if (isEditorOwned(path)) { return "done"; }
    const entry = readShareIndexDocFiles(context.session.index).get(path);
    if (!entry) { return reconcileUntracked(context, path, disk, settled); }
    return entry.kind === "text" ? reconcileText(context, path, disk, settled) : reconcileShareBlob(context, path, entry, disk, settled);
  };
}

/** Index edits reach disk: a listed, changed or removed file is reconciled, new text docs are listened to, and comments.json follows the map. */
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
  const settings = readShareIndexDocSettings(index);
  const onSettings = (event: Y.YMapEvent<unknown>) => {
    if (event.transaction.origin !== DISK_ORIGIN) { context.request(PROJECT_FILE, false); }
  };
  settings.observe(onSettings);
  const comments = readShareIndexDocComments(index);
  const onComments = () => context.request(COMMENTS_PATH, false);
  comments.observeDeep(onComments);
  detach.push(() => files.unobserve(onFiles), () => settings.unobserve(onSettings), () => comments.unobserveDeep(onComments));
}

async function scan(context: MirrorContext, queue: PathQueue): Promise<void> {
  const onDisk = await context.disk.list();
  const listed = [...readShareIndexDocFiles(context.session.index).keys()];
  listed.forEach((path) => context.attach(path));
  const paths = new Set([PROJECT_FILE, COMMENTS_PATH, ...listed, ...deriveSharedPaths(onDisk)]);
  paths.forEach((path) => queue.request(path, false));
  await context.logger.log("INFO", LOG_MODULE, "Started mirroring a shared project", { folder: context.folder, listed: listed.length, onDisk: onDisk.length });
}
