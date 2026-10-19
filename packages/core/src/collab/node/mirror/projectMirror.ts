// Mirrors a shared project between its share docs and its folder on disk, in both directions.
import { promises as fs } from "node:fs";
import type * as Y from "yjs";
import type { ILogger } from "../../../ports/index.js";
import { listProjectFiles, PROJECT_FILE } from "../../../writing/project/index.js";
import { nodeFileReads } from "../../../writing/project/node/index.js";
import { indexFiles, indexSettings, isSafeSharePath, SHARED_TOOL_FILES, sharedPaths, type ShareFileEntry } from "../../model/index.js";
import type { BlobExchange, ShareSession } from "../../sync/index.js";
import type { CollabStore } from "../state/index.js";
import { reconcileBlob } from "./blobMirror.js";
import { diskPath, DISK_ORIGIN, LOG_MODULE, type MirrorContext } from "./mirrorContext.js";
import { reconcileSettings } from "./settingsMirror.js";
import { reconcileText } from "./textMirror.js";
import { reconcileUntracked } from "./untrackedFile.js";
import { PathQueue, readDisk, watchFolder, type ReconcileOutcome } from "./watch/index.js";

const DEFAULT_STABLE_MS = 300;

export interface ProjectMirrorOptions {
  /** The project folder, absolute. */
  folder: string;
  session: ShareSession;
  blobs: BlobExchange;
  store: CollabStore;
  logger: ILogger;
  /** True for a path an open editor holds; the editor binding syncs it, so the mirror leaves it alone until `changed`. */
  isEditorOwned?: (path: string) => boolean;
  /** Watches the folder with a recursive fs.watch; false when the caller feeds `changed` itself. */
  watch?: boolean;
  /** How long a changed file must stay the same before it is read. */
  stableMs?: number;
}

export interface ProjectMirror {
  /** Reports a changed, created or deleted file by its POSIX path relative to the folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  /** Resolves when no change is waiting or being applied. */
  idle(): Promise<void>;
  /** Stops and waits for the writes in flight; close the blob exchange first, or a fetch in flight holds this open. */
  close(): Promise<void>;
}

/** Starts mirroring and reconciles every listed and every shared file once. */
export function startProjectMirror(options: ProjectMirrorOptions): ProjectMirror {
  const { folder, session, logger } = options;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
  const isEditorOwned = options.isEditorOwned ?? (() => false);
  const detach: (() => void)[] = [];
  const attached = new Set<string>();
  const refused = new Set<string>();
  const queue = new PathQueue({ stableMs, logger, run: (path, settled) => reconcile(path, settled) });
  const context: MirrorContext = {
    folder, session, blobs: options.blobs, store: options.store, logger, bases: new Map(), settingsBase: undefined, missingBlobs: new Set(),
    request: (path, settle) => queue.request(path, settle),
    attach: (path) => attach(path),
  };

  function attach(path: string): void {
    if (attached.has(path) || !isSafeSharePath(path) || indexFiles(session.index).get(path)?.kind !== "text") { return; }
    attached.add(path);
    const doc = session.openDoc(path);
    const onUpdate = (_update: Uint8Array, origin: unknown) => { if (origin !== DISK_ORIGIN) { queue.request(path, false); } };
    doc.on("update", onUpdate);
    detach.push(() => doc.off("update", onUpdate));
  }

  async function reconcile(path: string, settled: boolean): Promise<ReconcileOutcome> {
    if (path !== PROJECT_FILE && !isSafeSharePath(path)) {
      if (refused.has(path)) { return "done"; }
      refused.add(path);
      await logger.log("WARN", LOG_MODULE, "Refused a shared path that is not safe to write", { folder, path });
      return "done";
    }
    const disk = await readDisk(diskPath(context, path), settled ? stableMs : undefined);
    if (path === PROJECT_FILE) { return reconcileSettings(context, disk, settled); }
    if (isEditorOwned(path)) { return "done"; }
    const entry = indexFiles(session.index).get(path);
    if (!entry) { return reconcileUntracked(context, path, disk, settled); }
    return entry.kind === "text" ? reconcileText(context, path, disk, settled) : reconcileBlob(context, path, entry, disk, settled);
  }

  observe(session.index, context, attach, detach);
  detach.push(session.onPeer((_peer, joined) => { if (joined) { context.missingBlobs.forEach((path) => queue.request(path, false)); } }));
  if (options.watch !== false) { detach.push(watchFolder(folder, (path) => changed(path), logger)); }
  queue.track(scan(context, queue).catch((error: unknown) => logger.error(LOG_MODULE, error, { folder, action: "first scan" })));

  function changed(path: string): void {
    if (path === PROJECT_FILE || sharedPaths([path]).length > 0) { queue.request(path, true); }
  }

  return {
    changed,
    idle: () => queue.idle(),
    close: async () => {
      detach.forEach((stop) => stop());
      await queue.close();
    },
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
  const onDisk = await listProjectFiles(nodeFileReads, context.folder);
  for (const tool of SHARED_TOOL_FILES) {
    if (await fs.stat(diskPath(context, tool)).then((stat) => stat.isFile(), () => false)) { onDisk.push(tool); }
  }
  const listed = [...indexFiles(context.session.index).keys()];
  listed.forEach((path) => context.attach(path));
  const paths = new Set([PROJECT_FILE, ...listed, ...sharedPaths(onDisk)]);
  paths.forEach((path) => queue.request(path, false));
  await context.logger.log("INFO", LOG_MODULE, "Started mirroring a shared project", { folder: context.folder, listed: listed.length, onDisk: onDisk.length });
}
