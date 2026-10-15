/**
 * Tracks the sync state the status bar shows: read from the background at start, polled while a sync runs, and a "sync now"
 * that runs one. The background's library.changed broadcast refreshes the library when a sync ends.
 */
import { errorMessage, type DriveStatus } from "@labshelf/core";
import { toast } from "@labshelf/core/dom";
import { sendRuntime } from "../../platform";

const POLL_INTERVAL_MS = 1500;
const POLL_MAX_TICKS = 120;

export interface SyncStatus {
  subscribe(listener: (status: DriveStatus | null) => void): () => void;
  syncNow(): Promise<void>;
}

export function createSyncStatus(): SyncStatus {
  let status: DriveStatus | null = null;
  let polling = false;
  const listeners = new Set<(s: DriveStatus | null) => void>();
  const set = (next: DriveStatus | null): void => {
    status = next;
    listeners.forEach((l) => l(status));
    if (next?.syncing && !polling) void poll();
  };
  const poll = async (): Promise<void> => {
    polling = true;
    try {
      for (let i = 0; i < POLL_MAX_TICKS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const sync = await sendRuntime<DriveStatus>({ type: "sync.status" });
        set(sync);
        if (sync.syncing) continue;
        if (sync.lastError) toast(`Sync failed — ${sync.lastError}`, "error");
        return;
      }
    } catch (err) {
      toast(`Sync status unavailable — ${errorMessage(err)}`, "error");
    } finally {
      polling = false;
    }
  };
  void sendRuntime<DriveStatus>({ type: "sync.status" }).then(set, () => set(null));
  return {
    subscribe(listener) { listeners.add(listener); listener(status); return () => { listeners.delete(listener); }; },
    async syncNow() {
      try { set(await sendRuntime<DriveStatus>({ type: "sync.now" })); } catch (err) { toast(`Sync failed — ${errorMessage(err)}`, "error"); }
    },
  };
}
