/** When automatic syncs run: the local-change debounce and the periodic "synced recently" skip. */
import type { SyncRunRecord } from "../engine/index.js";

/** A burst of local edits syncs once, this long after the last one. */
export const LOCAL_CHANGE_DEBOUNCE_MS = 30_000;

/**
 * Whether any app synced within the last half interval, so a periodic run would find nothing new.
 * @returns true when the periodic run should be skipped
 */
export function syncedRecently(lastRun: SyncRunRecord | undefined, nowMs: number, intervalMs: number): boolean {
  if (!lastRun) { return false; }
  return nowMs - Date.parse(lastRun.finishedAt) < intervalMs / 2;
}
