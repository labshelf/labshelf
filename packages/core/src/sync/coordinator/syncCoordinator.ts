/**
 * Drives the sync of one library for one app: on demand, after local changes and periodically, one run at a time, and
 * keeps a status the app renders. Platform access (files, lock, auth, timers) is injected.
 */
import { readSyncRunRecord } from "../engine/index.js";
import { runSyncOnce } from "./syncRun.js";
import { LOCAL_CHANGE_DEBOUNCE_MS, syncedRecently } from "./syncSchedule.js";
import { SyncStatusCell, type SyncStatusListener } from "./syncStatus.js";
import { SystemSyncTimers } from "./systemTimers.js";
import type { SyncCoordinatorDeps, SyncOutcome, SyncState, SyncStatus, SyncTimerId, SyncTimers } from "./types.js";

export class SyncCoordinator {
  private readonly cell = new SyncStatusCell();
  private readonly timers: SyncTimers;
  private readonly clock: () => Date;
  private readonly source: string;
  private running: Promise<SyncOutcome> | undefined;
  private intervalMs = 0;

  constructor(private readonly deps: SyncCoordinatorDeps) {
    this.timers = deps.timers ?? new SystemSyncTimers((id) => { void this.onTimer(id); });
    this.clock = deps.clock ?? (() => new Date());
    this.source = `${deps.app}/sync`;
  }

  /** @returns the latest status */
  status(): SyncStatus {
    return this.cell.get();
  }

  /** @returns an unsubscribe function */
  onStatus(listener: SyncStatusListener): () => void {
    return this.cell.subscribe(listener);
  }

  /**
   * Loads stored credentials and the last-run record.
   * @returns the status
   */
  async init(): Promise<SyncStatus> {
    await this.deps.auth.load?.();
    const lastRun = await this.readLastRun();
    this.cell.set({ state: this.baseState(), ...(lastRun ? { lastRun } : {}) });
    return this.cell.get();
  }

  /** Re-derives the state after a sign-in or sign-out. */
  refreshAuth(): void {
    if (this.cell.get().state === "syncing") { return; }
    this.cell.set({ state: this.baseState() }, ["lastError", "holder"]);
  }

  /**
   * Re-reads the shared last-run record (another app may have synced) and ends "waiting" once that app's lock is gone.
   * @returns void
   */
  async refreshLastRun(): Promise<void> {
    const lastRun = await this.readLastRun();
    if (lastRun && lastRun.finishedAt !== this.cell.get().lastRun?.finishedAt) { this.cell.set({ lastRun }); }
    const lock = this.deps.getTarget().lock;
    if (this.cell.get().state === "waiting" && (!lock || (await lock.store.read(lock.path)) === undefined)) {
      this.cell.set({ state: this.baseState() }, ["holder"]);
    }
  }

  /**
   * Runs one sync now. Concurrent calls share one run; a run by another app is reported as busy.
   * @returns what happened
   */
  syncNow(reason = "manual"): Promise<SyncOutcome> {
    this.running ??= this.run(reason).finally(() => { this.running = undefined; });
    return this.running;
  }

  /** Schedules a sync after the debounce; a burst of local changes syncs once. Does nothing while signed out. */
  scheduleLocalChange(): void {
    if (this.baseState() !== "idle") { return; }
    this.timers.start("debounce", LOCAL_CHANGE_DEBOUNCE_MS, false);
  }

  /** Cancels a scheduled local-change sync, e.g. because a manual one is starting. */
  cancelScheduled(): void {
    this.timers.cancel("debounce");
  }

  /** Syncs every `minutes`; zero or less turns periodic syncs off. */
  startPeriodic(minutes: number): void {
    this.timers.cancel("periodic");
    this.intervalMs = minutes > 0 ? minutes * 60_000 : 0;
    if (this.intervalMs > 0) { this.timers.start("periodic", this.intervalMs, true); }
  }

  /**
   * One periodic run, skipped while signed out, while periodic syncs are off, or when any app synced within the last
   * half interval.
   * @returns the outcome, or undefined when skipped
   */
  async periodicTick(): Promise<SyncOutcome | undefined> {
    if (this.intervalMs <= 0 || this.baseState() !== "idle") { return undefined; }
    await this.refreshLastRun();
    if (syncedRecently(this.cell.get().lastRun, this.clock().getTime(), this.intervalMs)) { return undefined; }
    return this.syncNow("periodic");
  }

  /**
   * Called by the host when one of its timers fires.
   * @returns the run the timer started, if any
   */
  onTimer(id: SyncTimerId): Promise<SyncOutcome | undefined> {
    return id === "debounce" ? this.syncNow("local-change") : this.periodicTick();
  }

  /**
   * Stops the timers; an in-flight sync finishes on its own.
   * @returns the in-flight sync, if any, so a quitting host can wait for it
   */
  stop(): Promise<SyncOutcome> | undefined {
    this.timers.cancel("debounce");
    this.timers.cancel("periodic");
    return this.running;
  }

  private baseState(): SyncState {
    const { auth } = this.deps;
    if (auth.isConfigured && !auth.isConfigured()) { return "unconfigured"; }
    return auth.isAuthenticated() ? "idle" : "disconnected";
  }

  private async readLastRun(): Promise<SyncStatus["lastRun"]> {
    const { state } = this.deps.getTarget();
    return state.lastRunPath ? readSyncRunRecord(state.fs, state.lastRunPath) : undefined;
  }

  private async run(reason: string): Promise<SyncOutcome> {
    // Without a load step the state turns "syncing" before syncNow returns, so a host can answer with it at once.
    if (this.deps.auth.load) { await this.deps.auth.load(); }
    const outcome = this.gate() ?? (await this.attempt(reason));
    await this.report(outcome, reason);
    return outcome;
  }

  private gate(): SyncOutcome | undefined {
    const { auth } = this.deps;
    if (auth.isConfigured && !auth.isConfigured()) {
      this.cell.set({ state: "unconfigured" });
      return { kind: "skipped", reason: "no Google OAuth client configured" };
    }
    if (!auth.isAuthenticated()) {
      this.cell.set({ state: "disconnected" });
      return { kind: "skipped", reason: "not signed in to Google Drive" };
    }
    return undefined;
  }

  private async attempt(reason: string): Promise<SyncOutcome> {
    const { deps } = this;
    this.cell.set({ state: "syncing" }, ["lastError", "holder"]);
    try {
      const attempt = await runSyncOnce({
        target: deps.getTarget(),
        owner: { app: deps.app, pid: deps.pid ?? 0, host: deps.host },
        createProvider: () => deps.createProvider(),
        ...(deps.listTitles ? { listTitles: () => deps.listTitles!() } : {}),
        logger: deps.logger,
        source: this.source,
        clock: this.clock,
      });
      if (!attempt.ran) {
        this.cell.set({ state: "waiting", ...(attempt.holder ? { holder: attempt.holder } : {}) });
        await deps.logger.log("INFO", this.source, "Sync skipped: another app is syncing this library", { reason, holder: attempt.holder });
        return { kind: "busy", holder: attempt.holder };
      }
      this.cell.set({ state: "idle", lastRun: attempt.record }, ["holder"]);
      await deps.logger.log("INFO", this.source, "Sync finished", { reason, ...attempt.record });
      return { kind: "synced", record: attempt.record, result: attempt.result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reauth = deps.isReauthError?.(error) ?? false;
      this.cell.set({ state: reauth ? "disconnected" : "error", lastError: message });
      await deps.logger.log("ERROR", this.source, "Sync failed", { reason, message }, error instanceof Error ? error.stack : undefined);
      return { kind: "failed", error: message, reauth };
    }
  }

  private async report(outcome: SyncOutcome, reason: string): Promise<void> {
    if (!this.deps.onOutcome) { return; }
    try {
      await this.deps.onOutcome(outcome, reason);
    } catch (error) {
      await this.deps.logger.log("WARN", this.source, "Handling the sync outcome failed", {
        reason, outcome: outcome.kind, message: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
