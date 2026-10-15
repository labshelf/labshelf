/**
 * Implements SyncTimers over bx.alarms rather than setTimeout: an alarm survives the suspension of the MV3 service worker between
 * a change and the sync it schedules, and periodic syncs keep firing while no page is open.
 */
import type { ILogger, SyncTimerId, SyncTimers } from "@labshelf/core";
import { bx } from "../platform";

export const DEBOUNCED_SYNC_ALARM = "labshelf.debouncedSync";
export const AUTO_SYNC_ALARM = "labshelf.autoSync";
// Chrome MV3 honours at least 30 s for a delay and 1 minute for a period in production.
const MIN_DELAY_MINUTES = 0.5;
const MIN_PERIOD_MINUTES = 1;

const ALARMS: Record<SyncTimerId, string> = { debounce: DEBOUNCED_SYNC_ALARM, periodic: AUTO_SYNC_ALARM };

export class AlarmSyncTimers implements SyncTimers {
  // Alarm calls are asynchronous; chaining them keeps a cancel and the start that follows it in order.
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly logger: ILogger) {}

  start(id: SyncTimerId, delayMs: number, repeat: boolean): void {
    const minutes = delayMs / 60_000;
    const info = repeat
      ? { periodInMinutes: Math.max(MIN_PERIOD_MINUTES, Math.floor(minutes)) }
      : { delayInMinutes: Math.max(MIN_DELAY_MINUTES, minutes) };
    this.enqueue(id, () => bx.alarms.create(ALARMS[id], info));
  }

  cancel(id: SyncTimerId): void {
    this.enqueue(id, async () => { await bx.alarms.clear(ALARMS[id]); });
  }

  /** Forwards the sync alarms to `onTimer`, normally `SyncCoordinator.onTimer`. */
  listen(onTimer: (id: SyncTimerId) => void): void {
    bx.alarms.onAlarm.addListener((alarm) => {
      const id = (Object.keys(ALARMS) as SyncTimerId[]).find((key) => ALARMS[key] === alarm.name);
      if (id) onTimer(id);
    });
  }

  private enqueue(id: SyncTimerId, op: () => Promise<void>): void {
    this.queue = this.queue.then(op).catch((error: unknown) => this.logger.error("background/alarms", error, { alarm: ALARMS[id] }));
  }
}
