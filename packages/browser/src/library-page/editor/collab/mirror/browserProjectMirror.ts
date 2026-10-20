// Mirrors a shared project to the library source chosen when it starts, while this tab and no other app own the mirror.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import {
  libraryMirrorDisk, MirrorOwnershipLost, MirrorRootUnavailable, startProjectMirror, systemLeaseScheduler,
  type BlobExchange, type CollabStore, type ILogger, type LeaseHolder, type LeaseScheduler, type MirrorStopReason, type ShareSession,
} from "@labshelf/core";
import type { LibrarySource, LibrarySources, TabLease } from "../../../../storage";
import { createFolderRescan } from "./folderRescan";
import { onLocalFileChanges } from "./localFileChanges";
import { browserMergeText } from "./mergeText";
import { acquireMirrorLeases, type MirrorLeases } from "./mirrorLeases";

/** How often the mirror checks the library source and rescans a folder for edits made outside the browser. */
const RESCAN_INTERVAL_MS = 30_000;
const LOG_MODULE = "browser.collab.mirror";

export type BrowserMirrorStopReason = "tab-taken" | "folder-taken" | "root-unavailable" | "source-changed";

export interface BrowserProjectMirrorOptions {
  sources: Pick<LibrarySources, "folderFileSystem" | "browserFileSystem" | "getLibrarySource" | "onLibraryFilesChanged">;
  libraryId: string;
  shareId: string;
  /** The share's tab lease, held by the caller; the mirror stops when it is lost but never releases it. */
  tab: TabLease;
  /** The project folder, a "/"-separated path inside the library. */
  folder: string;
  session: ShareSession;
  blobs: BlobExchange;
  store: CollabStore;
  logger: ILogger;
  /** Called once when the mirror stops by itself; the share docs keep every edit, only the disk stops following them. */
  onStopped(reason: BrowserMirrorStopReason): void;
  scheduler?: LeaseScheduler;
}

export interface BrowserProjectMirror {
  /** Reports a changed path relative to the project folder; also call it when an editor lets a path go. */
  changed(path: string): void;
  idle(): Promise<void>;
  /** Stops mirroring and releases the folder lease; later calls return the same promise. */
  close(): Promise<void>;
}

export type BrowserMirrorStart =
  | { kind: "busy"; holder: LeaseHolder; takeOver(): Promise<BrowserMirrorStart> }
  | { kind: "running"; mirror: BrowserProjectMirror };

/** Thrown by the ownership check once the library uses another source than the one the mirror writes to. */
class LibrarySourceChanged extends MirrorRootUnavailable {}

const sameSource = (a: LibrarySource, b: LibrarySource): boolean =>
  a.kind === "browser" ? b.kind === "browser" : b.kind === "folder" && a.root === b.root && a.via === b.via;

export function startBrowserProjectMirror(options: BrowserProjectMirrorOptions): Promise<BrowserMirrorStart> {
  return start(options, false);
}

async function start(options: BrowserProjectMirrorOptions, takeOver: boolean): Promise<BrowserMirrorStart> {
  const { sources, tab, libraryId, shareId, folder, logger, scheduler } = options;
  const context = { libraryId, shareId, folder };
  const result = await acquireMirrorLeases({ sources, tab, folder, logger, takeOver, ...(scheduler ? { scheduler } : {}) });
  if (result.kind === "owned") {
    void logger.log("INFO", LOG_MODULE, "Mirroring the shared project", { ...context, source: result.leases.source.kind, takeOver });
    return { kind: "running", mirror: runMirror(options, result.leases) };
  }
  void logger.log("INFO", LOG_MODULE, "Another mirror owns the shared project", { ...context, holder: result.holder });
  return {
    kind: "busy",
    holder: result.holder,
    takeOver: () => {
      void logger.log("INFO", LOG_MODULE, "Taking the shared project mirror over", { ...context, holder: result.holder });
      return start(options, true);
    },
  };
}

function runMirror(options: BrowserProjectMirrorOptions, leases: MirrorLeases): BrowserProjectMirror {
  const { sources, folder, logger } = options;
  const scheduler = options.scheduler ?? systemLeaseScheduler;
  const context = { libraryId: options.libraryId, shareId: options.shareId, folder };
  let tabLost = false;
  let closing: Promise<void> | undefined;
  const assertOwned = async (): Promise<void> => {
    if (tabLost || closing) { throw new MirrorOwnershipLost(folder, { app: "browser", renewedAt: scheduler.now() }); }
    if (!sameSource(await sources.getLibrarySource(), leases.source)) {
      throw new LibrarySourceChanged(folder, { cause: new Error("source changed") });
    }
    await leases.folder?.assertOwned();
  };
  const reasonOf = (reason: MirrorStopReason): BrowserMirrorStopReason =>
    reason instanceof LibrarySourceChanged ? "source-changed"
      : reason instanceof MirrorRootUnavailable ? "root-unavailable"
        : tabLost ? "tab-taken" : "folder-taken";
  const disk = libraryMirrorDisk(leases.fs, folder);
  const mirror = startProjectMirror({
    folder, disk, mergeText: browserMergeText, session: options.session, blobs: options.blobs, store: options.store, logger,
    // An open editor edits the shared text itself and never writes the file, so the mirror writes every path, open ones included.
    ownership: { assertOwned }, onStopped: (reason) => stop(reasonOf(reason)),
  });
  const detach = watchFolder(options, leases, scheduler, mirror.changed, stop);
  const shutdown = (): Promise<void> => (closing ??= (async () => {
    detach();
    const released = Promise.resolve(leases.folder?.release()).catch((error: unknown) => {
      void logger.error(LOG_MODULE, error, { ...context, op: "releaseMirrorFolderLease" });
    });
    await Promise.all([mirror.close(), released]);
  })());
  function stop(reason: BrowserMirrorStopReason): void {
    if (closing) { return; }
    void logger.log("WARN", LOG_MODULE, "The shared project mirror stopped writing to disk", { ...context, reason });
    void shutdown();
    options.onStopped(reason);
  }
  leases.tab.onLost(() => { tabLost = true; stop("tab-taken"); });
  leases.folder?.onLost(() => stop("folder-taken"));
  return { changed: (path) => mirror.changed(path), idle: () => mirror.idle(), close: shutdown };
}

/** Feeds the mirror the paths the bridge and this page report and, for a folder, those a rescan finds; returns the function that stops them. */
function watchFolder(
  options: BrowserProjectMirrorOptions, leases: MirrorLeases, scheduler: LeaseScheduler,
  changed: (path: string) => void, stop: (reason: BrowserMirrorStopReason) => void,
): () => void {
  const { sources, folder, logger } = options;
  const prefix = `${folder}/`;
  const rescan = leases.folder ? createFolderRescan({ fs: leases.fs, folder, disk: libraryMirrorDisk(leases.fs, folder), changed, logger }) : undefined;
  const check = async (withSource: boolean): Promise<void> => {
    try {
      if (withSource && !sameSource(await sources.getLibrarySource(), leases.source)) { stop("source-changed"); return; }
      await rescan?.scan();
    } catch (error) {
      if (error instanceof MirrorRootUnavailable) { stop("root-unavailable"); return; }
      void logger.error(LOG_MODULE, error, { op: "rescanMirrorFolder", libraryId: options.libraryId, shareId: options.shareId, folder });
    }
  };
  void check(false);
  const inFolder = (paths: readonly string[]): void => paths.filter((path) => path.startsWith(prefix)).forEach((path) => changed(path.slice(prefix.length)));
  const stops = [
    sources.onLibraryFilesChanged(inFolder),
    onLocalFileChanges(inFolder),
    scheduler.every(RESCAN_INTERVAL_MS, () => void check(true)),
    onVisible(() => void check(false)),
  ];
  return () => stops.forEach((stopOne) => stopOne());
}

function onVisible(listener: () => void): () => void {
  if (typeof document === "undefined") { return () => undefined; }
  const handler = (): void => { if (document.visibilityState === "visible") { listener(); } };
  document.addEventListener("visibilitychange", handler);
  return () => document.removeEventListener("visibilitychange", handler);
}
