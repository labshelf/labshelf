/**
 * Builds the browser's sync coordinator over the IndexedDB file store, and maps its status to what the popup, options
 * and library pages show. The browser keeps its own manifest and meets the other apps only on Drive, so no lock.
 */
import { BROWSER_SYNC_ROOTS, createGoogleDriveProvider, SYNC_PROVIDER_ID, SyncCoordinator } from "@labshelf/core";
import type { IAuthProvider, ILogger, RemoteProvider, SyncStatus, SyncTimers } from "@labshelf/core";
import type { SyncStatusData } from "../platform";
import { IdbManifestFileSystem, IndexedDbFileSystem } from "../storage";

export interface BrowserSyncDeps {
  /** `load` restores the stored token before each sync, so a restarted service worker is still signed in. */
  auth: IAuthProvider & { isAuthenticated(): boolean; load(): Promise<void> };
  logger: ILogger;
  timers: SyncTimers;
  /** Runs after each successful sync, e.g. to rebuild the metadata cache and tell open pages. */
  onSynced: () => Promise<void>;
  /** Injectable for tests; defaults to the Drive provider. */
  createProvider?: () => RemoteProvider;
}

/** @returns the coordinator that syncs the IndexedDB library */
export function createBrowserSync(deps: BrowserSyncDeps): SyncCoordinator {
  const files = new IndexedDbFileSystem();
  const manifestFs = new IdbManifestFileSystem();
  return new SyncCoordinator({
    app: "browser",
    host: "browser",
    getTarget: () => ({ files, roots: BROWSER_SYNC_ROOTS, state: { fs: manifestFs, manifestPath: SYNC_PROVIDER_ID } }),
    auth: deps.auth,
    createProvider: deps.createProvider ?? (() => createGoogleDriveProvider(deps.auth)),
    logger: deps.logger,
    timers: deps.timers,
    onOutcome: async (outcome) => {
      if (outcome.kind === "synced") { await deps.onSynced(); }
    },
  });
}

/** @returns the status the extension pages render */
export function browserSyncStatus(status: SyncStatus, connected: boolean): SyncStatusData {
  return {
    connected,
    syncing: status.state === "syncing",
    lastSyncTime: status.lastRun?.finishedAt ?? null,
    lastError: status.lastError ?? null,
  };
}
