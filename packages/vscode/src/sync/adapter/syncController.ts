/** Drives the core sync coordinator from VS Code: Drive sign-in, library events, the interval setting and the status bar. */
import * as vscode from "vscode";

import { createGoogleDriveProvider, ReauthRequiredError, SyncCoordinator, syncRoots, type LibraryLayout } from "@labshelf/core";
import type { DriveStatus, IAuthProvider, ILogger, LocalFileSystem, LockStore, RemoteProvider, SyncOutcome, SyncResult, SyncTarget, SyncTimers } from "@labshelf/core";
import { reportSyncOutcome } from "./syncReport.js";
import type { EventBus } from "../../events/index.js";

/** The Drive sign-in the controller drives: tokens for the provider, plus the user-facing sign-in steps. */
export type DriveSignIn = IAuthProvider & {
  load(): Promise<void>;
  login(): Promise<void>;
  revoke(): Promise<void>;
  isAuthenticated(): boolean;
};

/** The machine and process that hold the sync lock. */
export interface SyncHost {
  name: string;
  pid: number;
}

/** Where the cross-app sync lock lives and how a holder's process is checked for life. */
export interface SyncLock {
  store: LockStore;
  isProcessAlive(pid: number): boolean;
}

export interface SyncControllerDeps {
  paths: LibraryLayout<vscode.Uri>;
  localFs: LocalFileSystem;
  eventBus: EventBus;
  logger: ILogger;
  host: SyncHost;
  lock: SyncLock;
  /** Paper id → title pairs used to name Drive folders. */
  listTitles?: () => Promise<Iterable<readonly [string, string]>>;
  /** Builds the Drive sign-in; the logger follows the library the controller points at. */
  createAuth: (logger: ILogger) => DriveSignIn;
  /** Injectable for tests; defaults to the Drive provider. */
  createProvider?: (auth: DriveSignIn) => RemoteProvider;
  /** Injectable for tests; defaults to setTimeout and setInterval. */
  timers?: SyncTimers;
}

const INTERVAL_SETTING = "sync.autoSyncIntervalMinutes";

export class SyncController implements vscode.Disposable {
  private readonly auth: DriveSignIn;
  private readonly lock: SyncLock;
  private readonly coordinator: SyncCoordinator;
  private paths: LibraryLayout<vscode.Uri>;
  private localFs: LocalFileSystem;
  private logger: ILogger;
  private readonly statusBar: vscode.StatusBarItem;
  private readonly _onDidChangeStatus = new vscode.EventEmitter<void>();
  readonly onDidChangeStatus: vscode.Event<void> = this._onDidChangeStatus.event;
  // Fired after a successful sync so the host can re-index when Drive pulled files in.
  private readonly _onDidSync = new vscode.EventEmitter<SyncResult>();
  readonly onDidSync: vscode.Event<SyncResult> = this._onDidSync.event;
  private readonly configListener: vscode.Disposable;

  constructor(deps: SyncControllerDeps) {
    this.paths = deps.paths;
    this.localFs = deps.localFs;
    this.logger = deps.logger;
    this.lock = deps.lock;
    // The logger follows setLibrary: each library writes its own log.
    const followingLogger: ILogger = { log: (...args) => this.logger.log(...args), error: (...args) => this.logger.error(...args) };
    this.auth = deps.createAuth(followingLogger);
    this.statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
    this.statusBar.command = "labshelf.sync.now";
    const createProvider = deps.createProvider ?? createGoogleDriveProvider;
    this.coordinator = new SyncCoordinator({
      app: "vscode",
      host: deps.host.name,
      pid: deps.host.pid,
      getTarget: () => this.target(),
      auth: { isAuthenticated: () => this.auth.isAuthenticated() },
      createProvider: () => createProvider(this.auth),
      ...(deps.listTitles ? { listTitles: deps.listTitles } : {}),
      logger: followingLogger,
      isReauthError: (error) => error instanceof ReauthRequiredError,
      onOutcome: (outcome, reason) => this.onOutcome(outcome, reason),
      ...(deps.timers ? { timers: deps.timers } : {}),
    });
    this.coordinator.onStatus((status) => {
      if (status.state === "syncing") { this.statusBar.text = "$(sync~spin) LabShelf Sync"; }
      this._onDidChangeStatus.fire();
    });
    const schedule = (): void => this.coordinator.scheduleLocalChange();
    for (const event of ["paper:added", "paper:deleted", "paper:updated", "annotation:created", "annotation:updated", "annotation:deleted"] as const) {
      deps.eventBus.on(event, schedule);
    }
    this.configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(`labshelf.${INTERVAL_SETTING}`)) { this.applyInterval(); }
    });
  }

  /** Points the controller at another library, so the lock, manifest and synced folders follow a reconfigured root. */
  setLibrary(paths: LibraryLayout<vscode.Uri>, localFs: LocalFileSystem, logger: ILogger): void {
    this.paths = paths;
    this.localFs = localFs;
    this.logger = logger;
  }

  /** Loads persisted auth state and the last run, and starts periodic syncs when signed in. */
  async initialize(): Promise<void> {
    await this.auth.load();
    await this.coordinator.init();
    this.updateStatusBar();
    this.applyInterval();
  }

  /** Signs in to Google Drive and runs an initial sync. */
  async connect(): Promise<void> {
    await this.auth.login();
    this.coordinator.refreshAuth();
    this.updateStatusBar();
    this.applyInterval();
    vscode.window.showInformationMessage("LabShelf: Connected to Google Drive.");
    await this.sync();
  }

  /** Revokes Google Drive credentials and stops scheduled syncs. */
  async disconnect(): Promise<void> {
    this.coordinator.cancelScheduled();
    this.coordinator.startPeriodic(0);
    await this.auth.revoke();
    this.coordinator.refreshAuth();
    this.updateStatusBar();
    vscode.window.showInformationMessage("LabShelf: Disconnected from Google Drive.");
  }

  /** Runs a sync on the user's request; the outcome is reported in the status bar and toasts. */
  async sync(): Promise<void> {
    await this.coordinator.syncNow("manual");
  }

  isConnected(): boolean {
    return this.auth.isAuthenticated();
  }

  isSyncing(): boolean {
    return this.coordinator.status().state === "syncing";
  }

  /** @returns what the settings page shows: the sign-in, a running sync, the last successful sync by any app and the last error */
  driveStatus(): DriveStatus {
    const status = this.coordinator.status();
    return {
      connected: this.isConnected(),
      syncing: this.isSyncing(),
      lastSyncTime: status.lastRun?.finishedAt ?? null,
      lastError: status.lastError ?? null,
    };
  }

  // Periodic syncs run only while signed in, at the interval the setting currently holds.
  private applyInterval(): void {
    const minutes = vscode.workspace.getConfiguration("labshelf").get<number>(INTERVAL_SETTING, 15);
    this.coordinator.startPeriodic(this.auth.isAuthenticated() ? minutes : 0);
  }

  private target(): SyncTarget {
    const roots = syncRoots(this.paths);
    return {
      files: this.localFs,
      roots: { library: roots.library.fsPath, appdata: roots.appdata.fsPath },
      state: { fs: this.localFs, manifestPath: this.paths.manifestPath().fsPath, lastRunPath: this.paths.lastRunPath().fsPath },
      lock: { store: this.lock.store, path: this.paths.lockPath().fsPath, isProcessAlive: this.lock.isProcessAlive },
    };
  }

  private onOutcome(outcome: SyncOutcome, reason: string): void {
    reportSyncOutcome(this.statusBar, outcome, reason === "manual");
    if (outcome.kind === "synced") { this._onDidSync.fire(outcome.result); }
    // A rejected refresh token signs the user out: the status bar must offer to connect again.
    if (outcome.kind === "failed" && outcome.reauth) {
      this.updateStatusBar();
      this.applyInterval();
    }
  }

  // Updates the status bar item to reflect the current auth state.
  private updateStatusBar(): void {
    const connected = this.auth.isAuthenticated();
    this.statusBar.text = connected ? "$(cloud) LabShelf" : "$(cloud-upload) LabShelf";
    this.statusBar.tooltip = connected
      ? "LabShelf: synced with Google Drive. Click to sync."
      : "LabShelf: not synced. Click to connect to Drive.";
    this.statusBar.command = connected ? "labshelf.sync.now" : "labshelf.sync.connect";
    this.statusBar.show();
    this._onDidChangeStatus.fire();
  }

  dispose(): void {
    void this.coordinator.stop();
    this.configListener.dispose();
    this._onDidChangeStatus.dispose();
    this._onDidSync.dispose();
    this.statusBar.dispose();
  }
}
