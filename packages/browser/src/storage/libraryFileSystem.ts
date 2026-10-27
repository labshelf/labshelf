// Picks where the library files live, a folder (picked in the browser or served by the bridge) or this browser's storage,
// and routes every call there.
import { BRIDGE_HOST_NAME, type ILogger, type LibraryFileSystem } from "@labshelf/core";
import { connectBrowserNative, createBrowserLogger, type NativePort } from "../platform";
import { BridgeClient, setBridgeLibrary, type BridgeFailureKind } from "./bridge";
import { IdbFileSystem } from "./idbFileSystem";
import { LibraryLocationChoice } from "./libraryLocationChoice";
import { DirFileSystem, ensureFolderGranted, readPickedDir, onPickedDirChange } from "./pickedDir";
import { refreshPaperRecords } from "./rebuildPaperRecords";

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
  connect: () => NativePort;
  /** The folder the user picked in the browser, which wins over the bridge. */
  pickedFolder: () => Promise<PickedDir | undefined>;
  onPickedFolderAnnounced: (listener: () => void) => void;
  logger: ILogger;
  browserFs: LibraryFileSystem;
  /** Refills the paper cache from the folder; runs once each time the probe chooses the folder. */
  rebuild: (folderFs: LibraryFileSystem) => Promise<void>;
}

const MODULE = "browser.storage.source";

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
