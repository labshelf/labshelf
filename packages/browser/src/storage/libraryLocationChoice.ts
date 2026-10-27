// Remembers which source the library files come from, a folder or this browser's storage, and probes for it when none is chosen.
import type { ILogger, LibraryFileSystem } from "@labshelf/core";
import { BridgeFileSystem, deriveBridgeFailure, type BridgeClient, type OpenBridge } from "./bridge";
import type { LibraryLocation, PickedDir, SourceDeps } from "./libraryFileSystem";

export type FolderSource = Extract<LibraryLocation, { kind: "folder" }>;

const MODULE = "browser.storage.source";
// Contexts that chose browser storage find a bridge connected later without a restart; a missing host fails fast.
const BROWSER_CHOICE_MS = 60_000;

export class LibraryLocationChoice {
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
