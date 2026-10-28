// Mirrors a shared project to the library source chosen when it starts, while this tab and no other app own the mirror, and carries the page's own writes to it.
// CONTRACT: documents/contracts/collaboration.md#mirror-ownership
import {
  createWriteRecordStore, createLibraryMirrorFileSystem, MirrorLostError, MirrorProjectDirUnavailable, startProjectMirror, systemLeaseScheduler, createTextMerge, openFolderLease, createListeners,
  DEVICE_ID, posixPathOps,
  type ShareBlobExchange, type CollabStore, type ILogger, type LeaseHolder, type LeaseScheduler, type MirrorStopReason, type ShareSession, type MergeText, type FolderLease, type LibraryFileSystem, type MirrorFileSystem,
} from "@labshelf/core";
import { diff3Merge } from "node-diff3";
import { createBrowserDeviceIdentity, type LibraryLocation, type LibraryLocations, type TabLease } from "../storage";

interface MirrorLeaseOptions {
  sources: Pick<LibraryLocations, "folderFileSystem" | "browserFileSystem" | "getLibrarySource">;
  /** Held by the caller for the whole share session; the mirror never acquires or releases it. */
  tab: TabLease;
  folder: string;
  logger: ILogger;
  scheduler?: LeaseScheduler;
  takeOver: boolean;
}

interface MirrorLeases {
  /** The source the leases were taken on; the mirror stops when the library moves to another. */
  source: LibraryLocation;
  /** The file system of `source` alone, so a later source choice cannot redirect the mirror's writes. */
  fs: LibraryFileSystem;
  tab: TabLease;
  /** Absent for browser storage, which only this profile's tabs can reach. */
  folder?: FolderLease;
}

type MirrorLeasesResult =
  | { kind: "busy"; holder: LeaseHolder }
  | { kind: "owned"; leases: MirrorLeases };

async function acquireMirrorLeases(options: MirrorLeaseOptions): Promise<MirrorLeasesResult> {
  const { sources, tab, folder, logger, scheduler, takeOver } = options;
  const source = await sources.getLibrarySource();
  if (source.kind === "browser") { return { kind: "owned", leases: { source, fs: sources.browserFileSystem, tab } }; }
  const fs = sources.folderFileSystem;
  const result = await openFolderLease({ fs, folder, app: "browser", logger, takeOver, ...(scheduler ? { scheduler } : {}) });
  if (result.kind === "busy") { return result; }
  return { kind: "owned", leases: { source, fs, tab, folder: result.lease } };
}

const browserMergeText: MergeText = createTextMerge(diff3Merge);

/** How often the mirror checks the library source and rescans a folder for edits made outside the browser. */
const RESCAN_INTERVAL_MS = 30_000;
const LOG_MODULE = "browser.collab.mirror";

export type BrowserMirrorStopReason = "tab-taken" | "folder-taken" | "root-unavailable" | "source-changed";

export interface BrowserProjectMirrorOptions {
  sources: Pick<LibraryLocations, "folderFileSystem" | "browserFileSystem" | "getLibrarySource" | "onLibraryFilesChanged">;
  libraryId: string;
  shareId: string;
  /** The share's tab lease, held by the caller; the mirror stops when it is lost but never releases it. */
  tab: TabLease;
  /** The project folder, a "/"-separated path inside the library. */
  folder: string;
  session: ShareSession;
  blobs: ShareBlobExchange;
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
class LibrarySourceChanged extends MirrorProjectDirUnavailable {}

const sameSource = (a: LibraryLocation, b: LibraryLocation): boolean =>
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
    if (tabLost || closing) { throw new MirrorLostError(folder, { app: "browser", renewedAt: scheduler.now() }); }
    if (!sameSource(await sources.getLibrarySource(), leases.source)) {
      throw new LibrarySourceChanged(folder, { cause: new Error("source changed") });
    }
    await leases.folder?.assertOwned();
  };
  const reasonOf = (reason: MirrorStopReason): BrowserMirrorStopReason =>
    reason instanceof LibrarySourceChanged ? "source-changed"
      : reason instanceof MirrorProjectDirUnavailable ? "root-unavailable"
        : tabLost ? "tab-taken" : "folder-taken";
  const disk = createLibraryMirrorFileSystem(leases.fs, folder);
  const mirror = startProjectMirror({
    writeRecords: createWriteRecordStore(leases.fs, folder, createBrowserDeviceIdentity(options.libraryId, logger), logger),
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
  const rescan = leases.folder ? createFolderRescan({ fs: leases.fs, folder, disk: createLibraryMirrorFileSystem(leases.fs, folder), changed, logger }) : undefined;
  const check = async (withSource: boolean): Promise<void> => {
    try {
      if (withSource && !sameSource(await sources.getLibrarySource(), leases.source)) { stop("source-changed"); return; }
      await rescan?.scan();
    } catch (error) {
      if (error instanceof MirrorProjectDirUnavailable) { stop("root-unavailable"); return; }
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

/** Bounds the stat calls of one scan; a project folder past this is not mirrored in full. */
const RESCAN_MAX_PATHS = 2_000;

export interface FolderRescanOptions {
  fs: LibraryFileSystem;
  folder: string;
  disk: MirrorFileSystem;
  changed(path: string): void;
  logger: ILogger;
}

export interface FolderRescan {
  /** Reports every path changed, created or deleted since the last scan; the first scan only records. Throws MirrorProjectDirUnavailable. */
  scan(): Promise<void>;
}

export function createFolderRescan(options: FolderRescanOptions): FolderRescan {
  const { fs, folder, disk, changed, logger } = options;
  let known: Map<string, string> | undefined;
  let running: Promise<void> | undefined;

  const fingerprint = async (path: string): Promise<string | undefined> => {
    try {
      const stat = await fs.stat(posixPathOps.join(folder, ...path.split("/")));
      return stat?.isFile === true ? `${stat.mtimeMs}:${stat.size}` : undefined;
    } catch (error) {
      void logger.error(LOG_MODULE, error, { op: "rescanStat", folder, path, note: "kept as unchanged until the next scan" });
      return known?.get(path);
    }
  };

  const run = async (): Promise<void> => {
    const [listed, records] = await Promise.all([disk.list(), fs.listDir(posixPathOps.join(folder, ".labshelf", "writes"))]);
    listed.push(...records.filter(name => name.endsWith(".json") && DEVICE_ID.test(name.slice(0, -5))).map(name => `.labshelf/writes/${name}`));
    if (listed.length > RESCAN_MAX_PATHS) {
      void logger.log("WARN", LOG_MODULE, "Folder rescan covers only the first files", { folder, files: listed.length, max: RESCAN_MAX_PATHS });
    }
    const next = new Map<string, string>();
    for (const path of listed.slice(0, RESCAN_MAX_PATHS)) {
      const print = await fingerprint(path);
      if (print !== undefined) { next.set(path, print); }
    }
    const previous = known;
    known = next;
    if (!previous) { return; }
    for (const [path, print] of next) { if (previous.get(path) !== print) { changed(path); } }
    for (const path of previous.keys()) { if (!next.has(path)) { changed(path); } }
  };

  return {
    scan: () => (running ??= run().finally(() => { running = undefined; })),
  };
}


// TRAP: browser storage has no watcher and a folder is rescanned only every 30 s, so a page write reaches the share only through `reportPageWrites`.
type Listener = (paths: readonly string[]) => void;

const listeners = createListeners<readonly string[]>();

function report(paths: readonly string[]): void {
  listeners.emit(paths);
}

/** Paths are "/"-separated library paths: the written file, both paths of a rename, or the root of a removed tree. */
export function onLocalFileChanges(listener: Listener): () => void {
  return listeners.add(listener);
}

/** The page's file system, which reports every write it completes; the mirrors write past it, so their own writes come back to none. */
export function reportPageWrites(fs: LibraryFileSystem): LibraryFileSystem {
  const after = <A extends unknown[]>(write: (...args: A) => Promise<void>, paths: (...args: A) => string[]) =>
    async (...args: A): Promise<void> => { await write(...args); report(paths(...args)); };
  // Each method is bound here, since an adapter may keep them on its prototype, which a spread drops.
  return {
    readText: (path) => fs.readText(path),
    exists: (path) => fs.exists(path),
    ensureDir: (path) => fs.ensureDir(path),
    listDir: (path) => fs.listDir(path),
    readFile: (path) => fs.readFile(path),
    stat: (path) => fs.stat(path),
    mkdir: (dir) => fs.mkdir(dir),
    writeText: after((path: string, text: string) => fs.writeText(path, text), (path) => [path]),
    writeFile: after((path: string, bytes: Uint8Array) => fs.writeFile(path, bytes), (path) => [path]),
    deleteFile: after((path: string) => fs.deleteFile(path), (path) => [path]),
    rename: after((from: string, to: string) => fs.rename(from, to), (from, to) => [from, to]),
    trash: after((target: string) => fs.trash(target), (target) => [target]),
    removeTree: after((target: string) => fs.removeTree(target), (target) => [target]),
  };
}
