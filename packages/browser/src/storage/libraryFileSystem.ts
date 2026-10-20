// Picks where the library files live, a folder (picked in the browser or served by the bridge) or this browser's storage,
// and routes every call there.
import { BRIDGE_HOST_NAME, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { connectBrowserNative, createBrowserLogger, type NativePort } from "../platform";
import { BridgeFileSystem, BridgeLink, classifyBridgeFailure, setBridgeLibrary, type BridgeFailureReason, type OpenBridge } from "./bridge";
import { IndexedDbFileSystem } from "./indexedDbFileSystem";
import { DirectoryFileSystem, grantedFolder, loadPickedFolder, onPickedFolderAnnounced } from "./picked";
import { rebuildRecords } from "./rebuild";

export type LibrarySource =
  | { kind: "folder"; root: string; via: "bridge" | "picked" }
  | { kind: "browser"; reason: BridgeFailureReason; detail?: string };
type FolderSource = Extract<LibrarySource, { kind: "folder" }>;

export interface LibrarySources {
  /** INVARIANT: one shared object; each call goes to exactly one source, never both. */
  fileSystem: LibraryFileSystem;
  /** The folder only; its calls fail when the folder is unreachable instead of reaching browser storage. */
  folderFileSystem: LibraryFileSystem;
  /** This browser's storage only, whatever the current choice; a later choice never redirects its calls. */
  browserFileSystem: LibraryFileSystem;
  getLibrarySource(): Promise<LibrarySource>;
  /** Probes the bridge again; only a context that chose browser storage can change its choice. */
  recheckLibrarySource(): Promise<LibrarySource>;
  /** Drops the current choice for the folder the user just picked; other contexts do the same when it is announced. */
  switchToPickedFolder(): Promise<LibrarySource>;
  /** Asks a host without a library to serve `root`; the caller then rechecks the source. */
  setLibraryFolder(root: string): Promise<void>;
  onLibraryFilesChanged(listener: (paths: string[]) => void): () => void;
  /** Fires in this context each time the rebuild that follows choosing the folder finishes, so open pages can reload their records. */
  onFolderRecordsRebuilt(listener: () => void): () => void;
}

export interface PickedFolder {
  name: string;
  fs: LibraryFileSystem;
}

interface SourceDeps {
  connect: () => NativePort;
  /** The folder the user picked in the browser, which wins over the bridge. */
  pickedFolder: () => Promise<PickedFolder | undefined>;
  onPickedFolderAnnounced: (listener: () => void) => void;
  logger: ILogger;
  browserFs: LibraryFileSystem;
  /** Refills the paper cache from the folder; runs once each time the probe chooses the folder. */
  rebuild: (folderFs: LibraryFileSystem) => Promise<void>;
}

const MODULE = "browser.storage.source";
// Contexts that chose browser storage find a bridge connected later without a restart; a missing host fails fast.
const BROWSER_CHOICE_MS = 60_000;

export function createLibrarySources(deps: SourceDeps): LibrarySources {
  const { connect, logger, browserFs, rebuild } = deps;
  const link = new BridgeLink(connect, logger);
  // INVARIANT: once set, this context uses only the folder until the user picks one; a dead link or a revoked
  // permission fails calls and never falls back to browser storage.
  let folder: FolderSource | undefined;
  const openFolder = async (): Promise<OpenBridge> => {
    const opened = await link.open();
    if (folder?.via === "bridge") folder = { kind: "folder", root: opened.hello.libraryRoot, via: "bridge" };
    return opened;
  };
  // Every folder call opens the link, so after the port dies the next call probes the bridge again.
  const bridgeFs = new BridgeFileSystem(async () => (await openFolder()).connection);
  let folderFs: LibraryFileSystem = bridgeFs;
  let browserChoice: Promise<LibrarySource> | undefined;
  let browserSince: number | undefined;
  const rebuiltListeners = new Set<() => void>();

  const getLibrarySource = (): Promise<LibrarySource> => {
    if (folder) return Promise.resolve(folder);
    if (browserSince !== undefined && Date.now() - browserSince > BROWSER_CHOICE_MS) {
      browserChoice = undefined;
      browserSince = undefined;
    }
    return (browserChoice ??= probe());
  };

  const chooseFolder = (source: FolderSource, fs: LibraryFileSystem): FolderSource => {
    void logger.log("INFO", MODULE, "Library files come from the folder", { root: source.root, via: source.via });
    folder = source;
    folderFs = fs;
    // The cache holds whatever an earlier choice left, so the folder's papers are not listed until it is rebuilt.
    // INVARIANT: not awaited, because the scan reads through `fs`, which does not wait for this probe.
    rebuild(fs).then(
      () => rebuiltListeners.forEach((listener) => listener()),
      (error: unknown) => logger.error(MODULE, error, { op: "rebuildOnFolderChoice", root: source.root, via: source.via }),
    );
    return source;
  };

  const loadPicked = (): Promise<PickedFolder | undefined> => deps.pickedFolder().catch((error: unknown) => {
    void logger.error(MODULE, error, { op: "loadPickedFolder", note: "probing the bridge instead" });
    return undefined;
  });

  const probe = async (): Promise<LibrarySource> => {
    const picked = await loadPicked();
    if (picked) return chooseFolder({ kind: "folder", root: picked.name, via: "picked" }, picked.fs);
    return probeBridge();
  };

  const probeBridge = (): Promise<LibrarySource> => link.open().then(
    ({ hello }): LibrarySource => chooseFolder({ kind: "folder", root: hello.libraryRoot, via: "bridge" }, bridgeFs),
    (error: unknown): LibrarySource => {
      const failure = classifyBridgeFailure(error);
      browserSince = Date.now();
      void logger.log("WARN", MODULE, "Library files come from browser storage", { ...failure });
      return { kind: "browser", ...failure };
    },
  );

  const fileSystem = routedFileSystem(async () => ((await getLibrarySource()).kind === "browser" ? browserFs : folderFs));
  const recheckLibrarySource = async (): Promise<LibrarySource> => {
    if (!folder) {
      browserChoice = undefined;
      browserSince = undefined;
      return getLibrarySource();
    }
    if (folder.via === "picked") return folder;
    await openFolder().catch((error: unknown) => logger.error(MODULE, error, { note: "the folder stays the library source; its calls fail until the bridge is back" }));
    return folder;
  };
  const switchToPickedFolder = (): Promise<LibrarySource> => {
    folder = undefined;
    browserChoice = undefined;
    browserSince = undefined;
    return getLibrarySource();
  };
  deps.onPickedFolderAnnounced(() => {
    switchToPickedFolder().catch((error: unknown) => logger.error(MODULE, error, { op: "switchToPickedFolder" }));
  });
  const setLibraryFolder = async (root: string): Promise<void> => { await setBridgeLibrary(connect, logger, root); };
  return {
    fileSystem, folderFileSystem: routedFileSystem(async () => folderFs), browserFileSystem: browserFs, getLibrarySource, recheckLibrarySource,
    switchToPickedFolder, setLibraryFolder,
    onLibraryFilesChanged: (listener) => link.onChanged(listener),
    onFolderRecordsRebuilt: (listener) => {
      rebuiltListeners.add(listener);
      return () => { rebuiltListeners.delete(listener); };
    },
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
    pickedFolder: async () => {
      const handle = await loadPickedFolder();
      return handle && { name: handle.name, fs: new DirectoryFileSystem(() => grantedFolder(handle)) };
    },
    onPickedFolderAnnounced,
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

export function switchToPickedFolder(): Promise<LibrarySource> {
  return sharedSources().switchToPickedFolder();
}

export function setLibraryFolder(root: string): Promise<void> {
  return sharedSources().setLibraryFolder(root);
}

export function onLibraryFilesChanged(listener: (paths: string[]) => void): () => void {
  return sharedSources().onLibraryFilesChanged(listener);
}

export function onFolderRecordsRebuilt(listener: () => void): () => void {
  return sharedSources().onFolderRecordsRebuilt(listener);
}
