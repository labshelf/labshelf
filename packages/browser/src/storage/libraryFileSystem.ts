// Picks where the library files live, the folder through the bridge or this browser's storage, and routes every call there.
import { BRIDGE_HOST_NAME, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { connectBrowserNative, createBrowserLogger, type NativePort } from "../platform";
import { BridgeFileSystem, BridgeLink, classifyBridgeFailure, setBridgeLibrary, type BridgeFailureReason, type OpenBridge } from "./bridge";
import { IndexedDbFileSystem } from "./indexedDbFileSystem";
import { rebuildRecords } from "./rebuild";

export type LibrarySource =
  | { kind: "folder"; root: string }
  | { kind: "browser"; reason: BridgeFailureReason; detail?: string };
type FolderSource = Extract<LibrarySource, { kind: "folder" }>;

export interface LibrarySources {
  /** INVARIANT: one shared object; each call goes to exactly one source, never both. */
  fileSystem: LibraryFileSystem;
  /** The folder through the bridge only; its calls fail when the bridge is down instead of reaching browser storage. */
  folderFileSystem: LibraryFileSystem;
  getLibrarySource(): Promise<LibrarySource>;
  /** Probes the bridge again; only a context that chose browser storage can change its choice. */
  recheckLibrarySource(): Promise<LibrarySource>;
  /** Asks a host without a library to serve `root`; the caller then rechecks the source. */
  setLibraryFolder(root: string): Promise<void>;
  onLibraryFilesChanged(listener: (paths: string[]) => void): () => void;
}

interface SourceDeps {
  connect: () => NativePort;
  logger: ILogger;
  browserFs: LibraryFileSystem;
  /** Refills the paper cache from the folder; runs once each time the probe chooses the folder. */
  rebuild: (folderFs: LibraryFileSystem) => Promise<void>;
}

const MODULE = "browser.storage.source";
// Contexts that chose browser storage find a bridge connected later without a restart; a missing host fails fast.
const BROWSER_CHOICE_MS = 60_000;

export function createLibrarySources({ connect, logger, browserFs, rebuild }: SourceDeps): LibrarySources {
  const link = new BridgeLink(connect, logger);
  // INVARIANT: once set, this context uses only the folder; a dead link fails calls and never falls back to browser storage.
  let folder: FolderSource | undefined;
  const openFolder = async (): Promise<OpenBridge> => {
    const opened = await link.open();
    if (folder) folder = { kind: "folder", root: opened.hello.libraryRoot };
    return opened;
  };
  // Every folder call opens the link, so after the port dies the next call probes the bridge again.
  const bridgeFs = new BridgeFileSystem(async () => (await openFolder()).connection);
  let browserChoice: Promise<LibrarySource> | undefined;
  let browserSince: number | undefined;

  const getLibrarySource = (): Promise<LibrarySource> => {
    if (folder) return Promise.resolve(folder);
    if (browserSince !== undefined && Date.now() - browserSince > BROWSER_CHOICE_MS) {
      browserChoice = undefined;
      browserSince = undefined;
    }
    return (browserChoice ??= probe());
  };

  const probe = (): Promise<LibrarySource> => link.open().then(
    ({ hello }): LibrarySource => {
      void logger.log("INFO", MODULE, "Library files come from the folder", { root: hello.libraryRoot });
      folder = { kind: "folder", root: hello.libraryRoot };
      // The cache holds whatever an earlier choice left, so the folder's papers are not listed until it is rebuilt.
      // INVARIANT: not awaited, because the scan reads through `bridgeFs`, which does not wait for this probe.
      rebuild(bridgeFs).catch((error: unknown) => logger.error(MODULE, error, { op: "rebuildOnFolderChoice", root: hello.libraryRoot }));
      return folder;
    },
    (error: unknown): LibrarySource => {
      const failure = classifyBridgeFailure(error);
      browserSince = Date.now();
      void logger.log("WARN", MODULE, "Library files come from browser storage", { ...failure });
      return { kind: "browser", ...failure };
    },
  );

  const fileSystem = routedFileSystem(async () => ((await getLibrarySource()).kind === "browser" ? browserFs : bridgeFs));
  const recheckLibrarySource = async (): Promise<LibrarySource> => {
    if (!folder) {
      browserChoice = undefined;
      browserSince = undefined;
      return getLibrarySource();
    }
    await openFolder().catch((error: unknown) => logger.error(MODULE, error, { note: "the folder stays the library source; its calls fail until the bridge is back" }));
    return folder;
  };
  const setLibraryFolder = async (root: string): Promise<void> => { await setBridgeLibrary(connect, logger, root); };
  return {
    fileSystem, folderFileSystem: bridgeFs, getLibrarySource, recheckLibrarySource, setLibraryFolder,
    onLibraryFilesChanged: (listener) => link.onChanged(listener),
  };
}

function routedFileSystem(pick: () => Promise<LibraryFileSystem>): LibraryFileSystem {
  const run = async <T>(call: (fs: LibraryFileSystem) => Promise<T>): Promise<T> => call(await pick());
  return {
    listDir: (path) => run((fs) => fs.listDir(path)),
    readFile: (path) => run((fs) => fs.readFile(path)),
    writeFile: (path, content) => run((fs) => fs.writeFile(path, content)),
    deleteFile: (path) => run((fs) => fs.deleteFile(path)),
    stat: (path) => run((fs) => fs.stat(path)),
    ensureDir: (path) => run((fs) => fs.ensureDir(path)),
    exists: (path) => run((fs) => fs.exists(path)),
    writeText: (path, text) => run((fs) => fs.writeText(path, text)),
    readText: (path) => run((fs) => fs.readText(path)),
    rename: (from, to) => run((fs) => fs.rename(from, to)),
    trash: (target) => run((fs) => fs.trash(target)),
    removeTree: (target) => run((fs) => fs.removeTree(target)),
    mkdir: (dir) => run((fs) => fs.mkdir(dir)),
  };
}

let shared: LibrarySources | undefined;

function sharedSources(): LibrarySources {
  if (shared) return shared;
  const logger = createBrowserLogger();
  shared = createLibrarySources({
    connect: () => connectBrowserNative(BRIDGE_HOST_NAME),
    logger,
    browserFs: new IndexedDbFileSystem(),
    rebuild: (folderFs) => rebuildRecords(folderFs, logger),
  });
  return shared;
}

export function rebuildFromFiles(logger: ILogger): Promise<void> {
  return rebuildRecords(sharedSources().fileSystem, logger);
}

export function createLibraryFileSystem(): LibraryFileSystem {
  return sharedSources().fileSystem;
}

export function getFolderFileSystem(): LibraryFileSystem {
  return sharedSources().folderFileSystem;
}

export function getLibrarySource(): Promise<LibrarySource> {
  return sharedSources().getLibrarySource();
}

export function recheckLibrarySource(): Promise<LibrarySource> {
  return sharedSources().recheckLibrarySource();
}

export function setLibraryFolder(root: string): Promise<void> {
  return sharedSources().setLibraryFolder(root);
}

export function onLibraryFilesChanged(listener: (paths: string[]) => void): () => void {
  return sharedSources().onLibraryFilesChanged(listener);
}
