// Watches whether the library root folder exists and reports when it disappears or returns.
import type { ILogger } from "../../ports/logger.js";

const MODULE = "externalChange";

export interface RootPresenceDeps {
  exists: () => Promise<boolean>;
  onLost: () => void;
  onReturned: () => void;
  logger: ILogger;
  intervalMs?: number;
}

// TRAP: scanLibrary returns an empty scan for a missing papers/ folder, so an unmounted root would empty the library on reindex.
export class RootPresenceMonitor {
  private present = true;
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<boolean> | undefined;

  constructor(private readonly deps: RootPresenceDeps) {}

  start(): void {
    if (this.timer) return;
    const timer = setInterval(() => void this.check(), this.deps.intervalMs ?? 5000);
    (timer as { unref?: () => void }).unref?.();
    this.timer = timer;
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Returns whether the root is present; overlapping calls share one check. */
  check(): Promise<boolean> {
    this.running ??= this.runCheck().finally(() => { this.running = undefined; });
    return this.running;
  }

  private async runCheck(): Promise<boolean> {
    let present: boolean;
    try {
      present = await this.deps.exists();
    } catch (error) {
      await this.deps.logger.log("WARN", MODULE, "Library folder check failed", { message: error instanceof Error ? error.message : String(error) });
      return this.present;
    }
    if (present === this.present) return present;
    this.present = present;
    if (present) {
      await this.deps.logger.log("INFO", MODULE, "Library folder returned");
      this.deps.onReturned();
    } else {
      await this.deps.logger.log("WARN", MODULE, "Library folder not found");
      this.deps.onLost();
    }
    return present;
  }
}
