/** Implements SyncTimers over setTimeout and setInterval, for hosts whose process stays alive between syncs. */
import type { SyncTimerId, SyncTimers } from "./types.js";

// Every JS runtime has these timers, but the runtime-neutral lib carries no typings for them.
interface TimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

// Looked up per call, so test fake timers installed after import are honoured.
const host = (): TimerHost => globalThis as unknown as TimerHost;

export class SystemSyncTimers implements SyncTimers {
  private readonly handles = new Map<SyncTimerId, { handle: unknown; repeat: boolean }>();

  constructor(private readonly fire: (id: SyncTimerId) => void) {}

  start(id: SyncTimerId, delayMs: number, repeat: boolean): void {
    this.cancel(id);
    const handle = repeat
      ? host().setInterval(() => this.fire(id), delayMs)
      : host().setTimeout(() => { this.handles.delete(id); this.fire(id); }, delayMs);
    // A pending sync must not keep a CLI process alive after its work is done.
    (handle as { unref?: () => void }).unref?.();
    this.handles.set(id, { handle, repeat });
  }

  cancel(id: SyncTimerId): void {
    const entry = this.handles.get(id);
    if (!entry) { return; }
    if (entry.repeat) { host().clearInterval(entry.handle); } else { host().clearTimeout(entry.handle); }
    this.handles.delete(id);
  }
}
