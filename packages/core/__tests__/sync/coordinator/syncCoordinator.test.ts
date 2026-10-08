import type { SyncOutcome, SyncStatus } from "@labshelf/core";
import { coordinatorHarness, foreignLock, LAST_RUN_PATH, LOCK_PATH, START } from "../../support/coordinatorHarness.js";

class ReauthError extends Error {}

describe("SyncCoordinator.init and status", () => {
  it("is idle when signed in, disconnected without tokens, unconfigured without a client", async () => {
    const h = coordinatorHarness();
    expect((await h.coordinator.init()).state).toBe("idle");
    h.auth.authenticated = false;
    expect((await h.coordinator.init()).state).toBe("disconnected");
    h.auth.configured = false;
    expect((await h.coordinator.init()).state).toBe("unconfigured");
  });

  it("reads the last-run record another app wrote", async () => {
    const h = coordinatorHarness();
    h.fs.seed(LAST_RUN_PATH, JSON.stringify({ app: "vscode", host: "desktop", finishedAt: "2026-05-16T10:00:00.000Z" }));
    expect((await h.coordinator.init()).lastRun).toMatchObject({ app: "vscode" });
  });

  it("refreshAuth follows a sign-in and a sign-out, dropping the last error", async () => {
    const h = coordinatorHarness();
    h.auth.authenticated = false;
    await h.coordinator.init();
    h.auth.authenticated = true;
    h.coordinator.refreshAuth();
    expect(h.coordinator.status().state).toBe("idle");
    h.auth.authenticated = false;
    h.coordinator.refreshAuth();
    expect(h.coordinator.status().state).toBe("disconnected");
  });
});

describe("SyncCoordinator.syncNow outcomes", () => {
  it("syncs, reports syncing then idle, and keeps the run as lastRun", async () => {
    const h = coordinatorHarness();
    await h.coordinator.init();
    const states: string[] = [];
    h.coordinator.onStatus((s: SyncStatus) => states.push(s.state));

    const outcome = await h.coordinator.syncNow();

    expect(outcome.kind).toBe("synced");
    expect(states).toEqual(["syncing", "idle"]);
    expect(h.coordinator.status().lastRun?.app).toBe("test");
    expect(h.logs).toContainEqual(expect.objectContaining({ level: "INFO", module: "test/sync", message: "Sync finished" }));
  });

  it("is busy and waiting, naming the holder, while another app holds the lock", async () => {
    const h = coordinatorHarness();
    h.lockStore.files.set(LOCK_PATH, foreignLock(START));

    const outcome = await h.coordinator.syncNow();

    expect(outcome).toEqual({ kind: "busy", holder: expect.objectContaining({ app: "vscode" }) });
    expect(h.coordinator.status()).toMatchObject({ state: "waiting", holder: { app: "vscode" } });
    expect(h.logs).toContainEqual(expect.objectContaining({ level: "INFO", message: "Sync skipped: another app is syncing this library" }));
  });

  it("leaves waiting once the other app's lock is gone", async () => {
    const h = coordinatorHarness();
    await h.coordinator.init();
    h.lockStore.files.set(LOCK_PATH, foreignLock(START));
    await h.coordinator.syncNow();
    h.lockStore.files.delete(LOCK_PATH);

    await h.coordinator.refreshLastRun();

    expect(h.coordinator.status().state).toBe("idle");
    expect(h.coordinator.status().holder).toBeUndefined();
  });

  it("skips while signed out or unconfigured, without touching the remote", async () => {
    const h = coordinatorHarness();
    const list = jest.spyOn(h.provider, "list");
    h.auth.authenticated = false;
    expect(await h.coordinator.syncNow()).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
    expect(h.coordinator.status().state).toBe("disconnected");
    h.auth.configured = false;
    expect(await h.coordinator.syncNow()).toEqual({ kind: "skipped", reason: "no Google OAuth client configured" });
    expect(h.coordinator.status().state).toBe("unconfigured");
    expect(list).not.toHaveBeenCalled();
  });

  it("reports a failure in the error state with the message, logs it, and recovers on the next run", async () => {
    const h = coordinatorHarness();
    h.provider.setConnected(false);

    const outcome = await h.coordinator.syncNow();

    expect(outcome).toEqual({ kind: "failed", error: expect.stringContaining("not connected"), reauth: false });
    expect(h.coordinator.status()).toMatchObject({ state: "error", lastError: expect.stringContaining("not connected") });
    expect(h.logs).toContainEqual(expect.objectContaining({ level: "ERROR", message: "Sync failed" }));
    h.provider.setConnected(true);
    expect((await h.coordinator.syncNow()).kind).toBe("synced");
    expect(h.coordinator.status().lastError).toBeUndefined();
  });

  it("maps an error that needs a new sign-in to disconnected with reauth", async () => {
    const h = coordinatorHarness({ isReauthError: (e) => e instanceof ReauthError });
    h.provider.resolveRoot = async () => { throw new ReauthError("expired"); };

    const outcome = await h.coordinator.syncNow();

    expect(outcome).toEqual({ kind: "failed", error: "expired", reauth: true });
    expect(h.coordinator.status().state).toBe("disconnected");
  });

  it("shares one run between concurrent calls", async () => {
    const h = coordinatorHarness();
    const resolveRoot = jest.spyOn(h.provider, "resolveRoot");

    const [a, b] = await Promise.all([h.coordinator.syncNow("manual"), h.coordinator.syncNow("idle")]);

    expect(a).toBe(b);
    expect(resolveRoot).toHaveBeenCalledTimes(2);
  });

  it("is syncing as soon as syncNow returns when the auth has no load step", async () => {
    const h = coordinatorHarness({ auth: { isAuthenticated: () => true } });
    const run = h.coordinator.syncNow();
    expect(h.coordinator.status().state).toBe("syncing");
    await run;
  });

  it("hands every outcome to onOutcome before syncNow resolves", async () => {
    const seen: Array<[SyncOutcome["kind"], string]> = [];
    const h = coordinatorHarness({ onOutcome: async (o, reason) => { seen.push([o.kind, reason]); } });
    await h.coordinator.syncNow("cli");
    expect(seen).toEqual([["synced", "cli"]]);
  });

  it("keeps the outcome when onOutcome throws, and warns", async () => {
    const h = coordinatorHarness({ onOutcome: () => { throw new Error("reload failed"); } });
    expect((await h.coordinator.syncNow()).kind).toBe("synced");
    expect(h.logs).toContainEqual(expect.objectContaining({ level: "WARN", message: "Handling the sync outcome failed" }));
  });

  it("stop() cancels the timers and hands back the run in flight", async () => {
    const h = coordinatorHarness();
    await h.coordinator.init();
    h.coordinator.startPeriodic(15);
    h.coordinator.scheduleLocalChange();
    expect(h.coordinator.stop()).toBeUndefined();
    expect(h.timers.armed.size).toBe(0);

    const run = h.coordinator.syncNow();
    expect(h.coordinator.stop()).toBe(run);
    await run;
  });
});
