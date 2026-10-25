// Sends at most one message per key and interval, keeping only the latest one that arrives in between.
import type { SessionScheduler } from "../../peer/index.js";

export class Throttle<K> {
  private lastAt = new Map<K, number>();
  private waiting = new Map<K, { bytes: Uint8Array; cancel: () => void }>();

  constructor(private intervalMs: number, private scheduler: SessionScheduler, private emit: (key: K, bytes: Uint8Array) => void) {}

  push(key: K, bytes: Uint8Array): void {
    const held = this.waiting.get(key);
    if (held) { held.bytes = bytes; return; }
    const last = this.lastAt.get(key);
    const now = this.scheduler.now();
    if (last === undefined || now - last >= this.intervalMs) { return this.send(key, bytes); }
    const entry = { bytes, cancel: () => {} };
    entry.cancel = this.scheduler.after(last + this.intervalMs - now, () => {
      this.waiting.delete(key);
      this.send(key, entry.bytes);
    });
    this.waiting.set(key, entry);
  }

  clear(): void {
    this.waiting.forEach((entry) => entry.cancel());
    this.waiting.clear();
    this.lastAt.clear();
  }

  private send(key: K, bytes: Uint8Array): void {
    this.lastAt.set(key, this.scheduler.now());
    this.emit(key, bytes);
  }
}
