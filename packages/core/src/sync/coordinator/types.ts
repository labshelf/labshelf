/** Declares the sync coordinator's types: what an app injects into it and what it reports back. */
import type { ILogger, LocalFileSystem, LockStore } from "../../ports/index.js";
import type { RemoteProvider } from "../provider/index.js";
import type { NamespaceRoots, SyncLockInfo, SyncResult, SyncRunRecord } from "../engine/index.js";

export type SyncState = "unconfigured" | "disconnected" | "idle" | "syncing" | "waiting" | "error";

export interface SyncStatus {
  state: SyncState;
  /** Last successful sync of this library, by any app when the run record is shared. */
  lastRun?: SyncRunRecord;
  lastError?: string;
  /** The app holding the lock while state is "waiting". */
  holder?: SyncLockInfo;
}

export type SyncOutcome =
  | { kind: "synced"; record: SyncRunRecord; result: SyncResult }
  | { kind: "busy"; holder: SyncLockInfo | undefined }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; error: string; reauth: boolean };

/** The library one run syncs: read fresh for every run, so a host can point the coordinator at another library. */
export interface SyncTarget {
  files: LocalFileSystem;
  roots: NamespaceRoots;
  state: { fs: LocalFileSystem; manifestPath: string; lastRunPath?: string };
  /** The cross-app lock; absent where no other app shares the local files. */
  lock?: { store: LockStore; path: string; isProcessAlive?: (pid: number) => boolean };
}

export type SyncTimerId = "debounce" | "periodic";

/** Timers the host provides; when one fires the host calls `SyncCoordinator.onTimer(id)`. */
export interface SyncTimers {
  start(id: SyncTimerId, delayMs: number, repeat: boolean): void;
  cancel(id: SyncTimerId): void;
}

export interface SyncAuthGate {
  isAuthenticated(): boolean;
  /** False when the app has no OAuth client at all; absent means always configured. */
  isConfigured?(): boolean;
  /** Loads stored credentials before the gate is checked. */
  load?(): Promise<void>;
}

export interface SyncCoordinatorDeps {
  /** "vscode", "terminal", "browser": names the lock holder, the run record and the log source. */
  app: string;
  host: string;
  pid?: number;
  getTarget(): SyncTarget;
  auth: SyncAuthGate;
  createProvider(): RemoteProvider;
  /** Paper id → title pairs naming the Drive paper folders; absent leaves folder names as they are locally. */
  listTitles?(): Promise<Iterable<readonly [id: string, title: string]>>;
  logger: ILogger;
  clock?: () => Date;
  timers?: SyncTimers;
  /** True for an error that only a new sign-in fixes. */
  isReauthError?(error: unknown): boolean;
  /** Awaited after every run, before syncNow resolves; a failure is logged and leaves the outcome as it is. */
  onOutcome?(outcome: SyncOutcome, reason: string): Promise<void> | void;
}
