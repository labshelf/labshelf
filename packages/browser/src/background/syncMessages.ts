/** Answers the sign-in and sync runtime messages and starts syncs for the background triggers. */
import type { SyncCoordinator } from "@labshelf/core";
import type { BrowserLogger, SyncStatusData } from "../platform";
import { browserSyncStatus } from "../sync";
import type { SyncTrigger } from "./syncOnIdle";

/** The parts of BrowserDriveAuth the handlers use. */
export interface DriveSignIn {
  load(): Promise<void>;
  isAuthenticated(): boolean;
  authenticate(): Promise<void>;
  revoke(): Promise<void>;
}

export interface SyncMessages {
  /** The status as it is now, without loading the token (for the badge's polling). */
  snapshot(): SyncStatusData;
  authStatus(): Promise<{ connected: boolean }>;
  connect(): Promise<{ connected: boolean }>;
  disconnect(): Promise<{ connected: boolean }>;
  status(): Promise<SyncStatusData>;
  syncNow(): Promise<SyncStatusData>;
  /** A change in IDB: coalesces the follow-up sync (the coordinator skips it while signed out). */
  scheduleSoon(reason: string): void;
  trigger: SyncTrigger;
}

/** @returns the handlers, bound to one auth and one coordinator */
export function createSyncMessages(auth: DriveSignIn, sync: SyncCoordinator, log: BrowserLogger): SyncMessages {
  const current = (): SyncStatusData => browserSyncStatus(sync.status(), auth.isAuthenticated());
  return {
    snapshot: current,
    async authStatus() {
      await auth.load();
      return { connected: auth.isAuthenticated() };
    },
    async connect() {
      await auth.authenticate();
      sync.refreshAuth();
      await log.info("authenticated to Google Drive");
      return { connected: true };
    },
    async disconnect() {
      await auth.revoke();
      sync.refreshAuth();
      await log.info("disconnected from Google Drive");
      return { connected: false };
    },
    async status() {
      await auth.load();
      return current();
    },
    // Answers once the run has started (or was skipped), not when it ends, so the popup shows "syncing" at once; a
    // pending debounced sync would only duplicate this one. The coordinator logs the outcome.
    async syncNow() {
      sync.cancelScheduled();
      if (sync.status().state === "syncing") {
        void sync.syncNow("manual");
        return current();
      }
      const started = new Promise<void>((resolve) => { const off = sync.onStatus(() => { off(); resolve(); }); });
      await Promise.race([started, sync.syncNow("manual")]);
      return current();
    },
    scheduleSoon(reason) {
      void log.info("sync scheduled", { reason });
      sync.scheduleLocalChange();
    },
    trigger(reason) {
      void log.info("sync trigger", { reason });
      void sync.syncNow(reason);
    },
  };
}
