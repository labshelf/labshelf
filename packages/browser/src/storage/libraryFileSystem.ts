// Picks where the library files live, a folder (picked in the browser or served by the bridge) or this browser's storage,
// and routes every call there.
import { BRIDGE_HOST_NAME, BridgeClient, BridgeFileSystem, deriveBridgeFailure, setBridgeLibrary } from "@labshelf/core";
import type { BridgeFailureKind, ILogger, LibraryFileSystem, NativeMessagePort, OpenBridge } from "@labshelf/core";
import { connectBrowserNative, createBrowserLogger } from "../platform";
import { IdbFileSystem } from "./idb";
import { DirFileSystem, ensureFolderGranted, readPickedDir, onPickedDirChange } from "./pickedDir";
import { refreshPaperRecords } from "./records";

export type LibraryLocation =
  | { kind: "folder"; root: string; via: "bridge" | "picked" }
  | { kind: "browser"; reason: BridgeFailureKind; detail?: string };

export interface LibraryLocations {
  /** INVARIANT: one shared object; each call goes to exactly one source, never both. */
  fileSystem: LibraryFileSystem;
  /** The folder only; its calls fail when the folder is unreachable instead of reaching browser storage. */
  folderFileSystem: LibraryFileSystem;
  /** This browser's storage only, whatever the current choice; a later choice never redirects its calls. */
  browserFileSystem: LibraryFileSystem;
  getLibrarySource(): Promise<LibraryLocation>;
  /** Probes the bridge again; only a context that chose browser storage can change its choice. */
  recheckLibrarySource(): Promise<LibraryLocation>;
  /** Drops the current choice for the folder the user just picked; other contexts do the same when it is announced. */
  switchToPickedFolder(): Promise<LibraryLocation>;
  /** Asks a host without a library to serve `root`; the caller then rechecks the source. */
  setLibraryFolder(root: string): Promise<void>;
  onLibraryFilesChanged(listener: (paths: string[]) => void): () => void;
  /** Fires in this context each time the rebuild that follows choosing the folder finishes, so open pages can reload their records. */
  onFolderRecordsRebuilt(listener: () => void): () => void;
}

export interface PickedDir {
  name: string;
  fs: LibraryFileSystem;
}

export interface SourceDeps {
  connect: () => NativeMessagePort;
  /** The folder the user picked in the browser, which wins over the bridge. */
  pickedFolder: () => Promise<PickedDir | undefined>;
  onPickedFolderAnnounced: (listener: () => void) => void;
  logger: ILogger;
  browserFs: LibraryFileSystem;
  /** Refills the paper cache from the folder; runs once each time the probe chooses the folder. */
  rebuild: (folderFs: LibraryFileSystem) => Promise<void>;
}

type FolderSource = Extract<LibraryLocation, { kind: "folder" }>;

const MODULE = "browser.storage.source";
// Contexts that chose browser storage find a bridge connected later without a restart; a missing host fails fast.
const BROWSER_CHOICE_MS = 60_000;

/** Remembers which source the library files come from, a folder or this browser's storage, and probes for it when none is chosen. */
class LibraryLocationChoice {
  // INVARIANT: once set, this context uses only the folder until the user picks one; a dead link or a revoked
  // permission fails calls and never falls back to browser storage.
  private folder: FolderSource | undefined;
  private browserChoice: Promise<LibraryLocation> | undefined;
  private browserSince: number | undefined;
  private readonly rebuiltListeners = new Set<() => void>();
  private readonly logger: ILogger;
  // Every folder call opens the link, so after the port dies the next call probes the bridge again.
  private readonly bridgeFs = new BridgeFileSystem(async () => (await this.openFolder()).connection);
  /** The files of the chosen folder; the bridge's until a folder is chosen. */
  folderFs: LibraryFileSystem = this.bridgeFs;

  constructor(private readonly deps: SourceDeps, private readonly link: BridgeClient) {
    this.logger = deps.logger;
  }

  /** The chosen source, probing for it first when none is chosen or the browser choice is old enough to retry. */
  getLibrarySource = (): Promise<LibraryLocation> => {
    if (this.folder) return Promise.resolve(this.folder);
    if (this.browserSince !== undefined && Date.now() - this.browserSince > BROWSER_CHOICE_MS) this.forgetBrowserChoice();
    return (this.browserChoice ??= this.probe());
  };

  async recheckLibrarySource(): Promise<LibraryLocation> {
    if (!this.folder) {
      this.forgetBrowserChoice();
      return this.getLibrarySource();
    }
    if (this.folder.via === "picked") return this.folder;
    await this.openFolder().catch((error: unknown) => this.logger.error(MODULE, error, { note: "the folder stays the library source; its calls fail until the bridge is back" }));
    return this.folder;
  }

  switchToPickedFolder(): Promise<LibraryLocation> {
    this.folder = undefined;
    this.forgetBrowserChoice();
    return this.getLibrarySource();
  }

  onFolderRecordsRebuilt(listener: () => void): () => void {
    this.rebuiltListeners.add(listener);
    return () => { this.rebuiltListeners.delete(listener); };
  }

  private forgetBrowserChoice(): void {
    this.browserChoice = undefined;
    this.browserSince = undefined;
  }

  private async openFolder(): Promise<OpenBridge> {
    const opened = await this.link.open();
    if (this.folder?.via === "bridge") this.folder = { kind: "folder", root: opened.hello.libraryRoot, via: "bridge" };
    return opened;
  }

  private chooseFolder(source: FolderSource, fs: LibraryFileSystem): FolderSource {
    void this.logger.log("INFO", MODULE, "Library files come from the folder", { root: source.root, via: source.via });
    this.folder = source;
    this.folderFs = fs;
    // The cache holds whatever an earlier choice left, so the folder's papers are not listed until it is rebuilt.
    // INVARIANT: not awaited, because the scan reads through `fs`, which does not wait for this probe.
    this.deps.rebuild(fs).then(
      () => this.rebuiltListeners.forEach((listener) => listener()),
      (error: unknown) => this.logger.error(MODULE, error, { op: "rebuildOnFolderChoice", root: source.root, via: source.via }),
    );
    return source;
  }

  private loadPicked(): Promise<PickedDir | undefined> {
    return this.deps.pickedFolder().catch((error: unknown) => {
      void this.logger.error(MODULE, error, { op: "loadPickedFolder", note: "probing the bridge instead" });
      return undefined;
    });
  }

  private async probe(): Promise<LibraryLocation> {
    const picked = await this.loadPicked();
    if (picked) return this.chooseFolder({ kind: "folder", root: picked.name, via: "picked" }, picked.fs);
    return this.link.open().then(
      ({ hello }): LibraryLocation => this.chooseFolder({ kind: "folder", root: hello.libraryRoot, via: "bridge" }, this.bridgeFs),
      (error: unknown): LibraryLocation => {
        const failure = deriveBridgeFailure(error);
        this.browserSince = Date.now();
        void this.logger.log("WARN", MODULE, "Library files come from browser storage", { ...failure });
        return { kind: "browser", ...failure };
      },
    );
  }
}

export function createLibraryLocations(deps: SourceDeps): LibraryLocations {
  const { connect, logger, browserFs } = deps;
  const link = new BridgeClient(connect, logger);
  const choice = new LibraryLocationChoice(deps, link);
  const fileSystem = routedFileSystem(async () => ((await choice.getLibrarySource()).kind === "browser" ? browserFs : choice.folderFs));
  deps.onPickedFolderAnnounced(() => {
    choice.switchToPickedFolder().catch((error: unknown) => logger.error(MODULE, error, { op: "switchToPickedFolder" }));
  });
  return {
    fileSystem, folderFileSystem: routedFileSystem(async () => choice.folderFs), browserFileSystem: browserFs,
    getLibrarySource: choice.getLibrarySource,
    recheckLibrarySource: () => choice.recheckLibrarySource(),
    switchToPickedFolder: () => choice.switchToPickedFolder(),
    setLibraryFolder: async (root) => { await setBridgeLibrary(connect, logger, root); },
    onLibraryFilesChanged: (listener) => link.onChanged(listener),
    onFolderRecordsRebuilt: (listener) => choice.onFolderRecordsRebuilt(listener),
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

let shared: LibraryLocations | undefined;

function sharedSources(): LibraryLocations {
  if (shared) return shared;
  const logger = createBrowserLogger();
  shared = createLibraryLocations({
    connect: () => connectBrowserNative(BRIDGE_HOST_NAME),
    pickedFolder: async () => {
      const handle = await readPickedDir();
      return handle && { name: handle.name, fs: new DirFileSystem(() => ensureFolderGranted(handle)) };
    },
    onPickedFolderAnnounced: onPickedDirChange,
    logger,
    browserFs: new IdbFileSystem(),
    rebuild: (folderFs) => refreshPaperRecords(folderFs, logger),
  });
  return shared;
}

/** The page's one set of library sources, for composition roots that hand them to adapters. */
export function readLibraryLocations(): LibraryLocations {
  return sharedSources();
}

export function refreshFromFiles(logger: ILogger): Promise<void> {
  return refreshPaperRecords(sharedSources().fileSystem, logger);
}

export function createLibraryFileSystem(): LibraryFileSystem {
  return sharedSources().fileSystem;
}

export function readFolderFileSystem(): LibraryFileSystem {
  return sharedSources().folderFileSystem;
}

export function readLibraryLocation(): Promise<LibraryLocation> {
  return sharedSources().getLibrarySource();
}

export function refreshStoredLibraryLocation(): Promise<LibraryLocation> {
  return sharedSources().recheckLibrarySource();
}

export function attachPickedDir(): Promise<LibraryLocation> {
  return sharedSources().switchToPickedFolder();
}

export function setLibraryFolder(root: string): Promise<void> {
  return sharedSources().setLibraryFolder(root);
}

export function onLibraryFilesChanged(listener: (paths: string[]) => void): () => void {
  return sharedSources().onLibraryFilesChanged(listener);
}

export function onPaperRecordsRebuilt(listener: () => void): () => void {
  return sharedSources().onFolderRecordsRebuilt(listener);
}
