/** Holds the coordinator's current status and tells the listeners each time it changes. */
import type { SyncStatus } from "./types.js";

export type SyncStatusListener = (status: SyncStatus) => void;

export class SyncStatusCell {
  private current: SyncStatus = { state: "disconnected" };
  private readonly listeners = new Set<SyncStatusListener>();

  get(): SyncStatus {
    return this.current;
  }

  /**
   * Subscribes to status changes.
   * @returns an unsubscribe function
   */
  subscribe(listener: SyncStatusListener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Applies a patch, drops the `clear` keys, and notifies every listener. */
  set(patch: Partial<SyncStatus>, clear: Array<keyof SyncStatus> = []): void {
    const next: SyncStatus = { ...this.current, ...patch };
    for (const key of clear) { delete next[key]; }
    this.current = next;
    for (const listener of this.listeners) { listener(next); }
  }
}
