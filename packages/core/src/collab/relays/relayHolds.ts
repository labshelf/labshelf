// Holds relays down for an hour after a refusal for limits or three failures in a row, including the holds peers report.
import type { SessionScheduler } from "../sync/index.js";

// CONTRACT: documents/contracts/collaboration.md#relay-list
export const RELAY_DOWN_HOLD_MS = 60 * 60 * 1000;
export const FAILURES_BEFORE_HOLD = 3;

export class RelayHolds {
  private readonly until = new Map<string, number>();
  private readonly failures = new Map<string, number>();
  private readonly timers = new Map<string, () => void>();

  /** `ended` runs when a hold ends, so the caller can use the relay again. */
  constructor(private clock: SessionScheduler, private ended: () => void) {}

  isDown(url: string): boolean { return (this.until.get(url) ?? 0) > this.clock.now(); }

  /** True when the hold of `url` started or grew; a peer's hold is capped at one hour from this device's clock. */
  hold(url: string, until = Number.POSITIVE_INFINITY): boolean {
    const now = this.clock.now();
    const capped = Math.min(until, now + RELAY_DOWN_HOLD_MS);
    if (capped <= now || capped <= (this.until.get(url) ?? 0)) { return false; }
    this.until.set(url, capped);
    this.timers.get(url)?.();
    this.timers.set(url, this.clock.after(capped - now, () => {
      this.until.delete(url);
      this.timers.delete(url);
      this.failures.delete(url);
      this.ended();
    }));
    return true;
  }

  /** Counts one failure in a row; true when it put `url` on hold. */
  fail(url: string): boolean {
    const count = (this.failures.get(url) ?? 0) + 1;
    if (count < FAILURES_BEFORE_HOLD) { this.failures.set(url, count); return false; }
    this.failures.delete(url);
    return this.hold(url);
  }

  succeeded(url: string): void { this.failures.delete(url); }

  /** The holds in force, URL to the epoch milliseconds they end, as presence carries them. */
  active(): Record<string, number> {
    const now = this.clock.now();
    return Object.fromEntries([...this.until].filter(([, until]) => until > now));
  }

  close(): void {
    this.timers.forEach((cancel) => cancel());
    this.timers.clear();
  }
}
