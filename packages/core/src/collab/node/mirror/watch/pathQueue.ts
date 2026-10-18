// Runs one reconcile at a time per path, coalescing requests and waiting for settled files, and tells when all are done.
import type { ILogger } from "../../../../ports/index.js";

const LOG_MODULE = "collab.mirror";
/** A file still changing after this many settle rounds is left alone until it changes again. */
const MAX_SETTLE_ROUNDS = 20;

export type ReconcileOutcome = "done" | "changing";

export interface PathQueueOptions {
  stableMs: number;
  logger: ILogger;
  run(path: string, settled: boolean): Promise<ReconcileOutcome>;
}

export class PathQueue {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly running = new Set<string>();
  /** Path to whether the queued run must settle first. */
  private readonly queued = new Map<string, boolean>();
  private readonly rounds = new Map<string, number>();
  private readonly tracked = new Set<Promise<unknown>>();
  private waiters: (() => void)[] = [];
  private closed = false;

  constructor(private readonly options: PathQueueOptions) {}

  /** A settled request waits until no other settled request for the path came for `stableMs`. */
  request(path: string, settle: boolean): void {
    if (this.closed) { return; }
    if (!settle) { return this.enqueue(path, false); }
    clearTimeout(this.timers.get(path));
    this.timers.set(path, setTimeout(() => {
      this.timers.delete(path);
      this.enqueue(path, true);
    }, this.options.stableMs));
  }

  /** Counts other work, such as the first scan, towards being idle. */
  track(work: Promise<unknown>): void {
    this.tracked.add(work);
    void work.finally(() => { this.tracked.delete(work); this.notifyIdle(); });
  }

  idle(): Promise<void> {
    return this.isIdle() ? Promise.resolve() : new Promise((resolve) => this.waiters.push(resolve));
  }

  /** Drops waiting requests and waits for the runs in flight. */
  close(): Promise<void> {
    this.closed = true;
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
    this.queued.clear();
    return this.idle();
  }

  private enqueue(path: string, settle: boolean): void {
    if (this.closed) { return this.notifyIdle(); }
    if (this.running.has(path)) { return void this.queued.set(path, (this.queued.get(path) ?? false) || settle); }
    this.running.add(path);
    void this.options.run(path, settle).then((outcome) => this.settleRound(path, outcome), (error: unknown) =>
      this.options.logger.error(LOG_MODULE, error, { path, settle, action: "reconcile shared file" }),
    ).finally(() => {
      this.running.delete(path);
      const next = this.queued.get(path);
      if (next !== undefined) { this.queued.delete(path); this.enqueue(path, next); }
      this.notifyIdle();
    });
  }

  private async settleRound(path: string, outcome: ReconcileOutcome): Promise<void> {
    if (outcome === "done") { return void this.rounds.delete(path); }
    const round = (this.rounds.get(path) ?? 0) + 1;
    if (round <= MAX_SETTLE_ROUNDS) { this.rounds.set(path, round); return this.request(path, true); }
    this.rounds.delete(path);
    await this.options.logger.log("WARN", LOG_MODULE, "Left a file that kept changing or is not valid text", { path, rounds: round - 1 });
  }

  private isIdle(): boolean {
    return this.timers.size === 0 && this.running.size === 0 && this.tracked.size === 0;
  }

  private notifyIdle(): void {
    if (!this.isIdle()) { return; }
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach((resolve) => resolve());
  }
}
