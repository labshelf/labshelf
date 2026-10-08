import { SystemSyncTimers } from "../../../src/sync/coordinator/systemTimers.js";
import { LOCAL_CHANGE_DEBOUNCE_MS } from "../../../src/sync/coordinator/syncSchedule.js";
import { coordinatorHarness, LAST_RUN_PATH } from "../../support/coordinatorHarness.js";

const MINUTE = 60_000;

describe("SyncCoordinator local-change debounce", () => {
  it("arms one 30 s debounce for a burst of changes, and the timer runs one local-change sync", async () => {
    const h = coordinatorHarness();
    await h.coordinator.init();

    h.coordinator.scheduleLocalChange();
    h.coordinator.scheduleLocalChange();
    h.coordinator.scheduleLocalChange();

    expect(h.timers.armed.get("debounce")).toEqual({ delayMs: LOCAL_CHANGE_DEBOUNCE_MS, repeat: false });
    expect(LOCAL_CHANGE_DEBOUNCE_MS).toBe(30_000);
    expect((await h.coordinator.onTimer("debounce"))?.kind).toBe("synced");
  });

  it("schedules nothing while signed out or unconfigured", async () => {
    const h = coordinatorHarness();
    h.auth.authenticated = false;
    h.coordinator.scheduleLocalChange();
    h.auth.authenticated = true;
    h.auth.configured = false;
    h.coordinator.scheduleLocalChange();
    expect(h.timers.starts).toBe(0);
  });

  it("still schedules while a sync is running, so a change made during it is not lost", async () => {
    const h = coordinatorHarness();
    const run = h.coordinator.syncNow();
    h.coordinator.scheduleLocalChange();
    expect(h.timers.armed.has("debounce")).toBe(true);
    await run;
  });

  it("cancelScheduled drops a pending debounce", () => {
    const h = coordinatorHarness();
    h.coordinator.scheduleLocalChange();
    h.coordinator.cancelScheduled();
    expect(h.timers.armed.has("debounce")).toBe(false);
  });
});

describe("SyncCoordinator periodic runs", () => {
  it("arms a repeating timer for the interval; zero turns it off", () => {
    const h = coordinatorHarness();
    h.coordinator.startPeriodic(15);
    expect(h.timers.armed.get("periodic")).toEqual({ delayMs: 15 * MINUTE, repeat: true });
    h.coordinator.startPeriodic(0);
    expect(h.timers.armed.has("periodic")).toBe(false);
  });

  it("runs when nothing has ever synced", async () => {
    const h = coordinatorHarness();
    h.coordinator.startPeriodic(10);
    expect((await h.coordinator.periodicTick())?.kind).toBe("synced");
  });

  it("skips while the last run is younger than half the interval, and runs at half", async () => {
    const h = coordinatorHarness();
    h.coordinator.startPeriodic(10);
    await h.coordinator.syncNow();

    h.advance(5 * MINUTE - 1);
    expect(await h.coordinator.onTimer("periodic")).toBeUndefined();
    h.advance(1);
    expect((await h.coordinator.onTimer("periodic"))?.kind).toBe("synced");
  });

  it("skips when another app synced recently, read from the shared record", async () => {
    const h = coordinatorHarness();
    h.coordinator.startPeriodic(10);
    h.fs.seed(LAST_RUN_PATH, JSON.stringify({ app: "vscode", finishedAt: new Date(h.now() - MINUTE).toISOString() }));
    const resolveRoot = jest.spyOn(h.provider, "resolveRoot");

    expect(await h.coordinator.periodicTick()).toBeUndefined();
    expect(resolveRoot).not.toHaveBeenCalled();
  });

  it("does not skip a manual sync after a recent one", async () => {
    const h = coordinatorHarness();
    h.coordinator.startPeriodic(10);
    await h.coordinator.syncNow();
    expect((await h.coordinator.syncNow("manual")).kind).toBe("synced");
  });

  it("does nothing while signed out or while periodic syncs are off", async () => {
    const h = coordinatorHarness();
    expect(await h.coordinator.periodicTick()).toBeUndefined();
    h.coordinator.startPeriodic(10);
    h.auth.authenticated = false;
    expect(await h.coordinator.periodicTick()).toBeUndefined();
  });
});

describe("SystemSyncTimers", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("fires a one-shot timer once and a repeating one on every interval until cancelled", () => {
    const fired: string[] = [];
    const timers = new SystemSyncTimers((id) => fired.push(id));
    timers.start("debounce", 1_000, false);
    timers.start("periodic", 500, true);

    jest.advanceTimersByTime(1_500);
    timers.cancel("periodic");
    jest.advanceTimersByTime(5_000);

    expect(fired.filter((id) => id === "debounce")).toHaveLength(1);
    expect(fired.filter((id) => id === "periodic")).toHaveLength(3);
  });

  it("restarting a timer replaces the pending one", () => {
    const fired: string[] = [];
    const timers = new SystemSyncTimers((id) => fired.push(id));
    timers.start("debounce", 1_000, false);
    jest.advanceTimersByTime(900);
    timers.start("debounce", 1_000, false);
    jest.advanceTimersByTime(900);
    expect(fired).toEqual([]);
    jest.advanceTimersByTime(100);
    expect(fired).toEqual(["debounce"]);
  });
});
