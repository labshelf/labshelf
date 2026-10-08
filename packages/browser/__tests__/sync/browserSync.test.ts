jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

import type { ILogger, SyncTimers } from "@labshelf/core";
import { FakeRemoteProvider } from "@labshelf/core/test-support/sync-fakes";

import { browserSyncStatus, createBrowserSync } from "../../src/sync";
import { fakeFiles } from "../support/fakeIdb";

const timers: SyncTimers = { start: () => undefined, cancel: () => undefined };

function harness(authenticated: boolean) {
  const provider = new FakeRemoteProvider();
  const logs: Array<{ level: string; message: string }> = [];
  const logger: ILogger = { log: async (level, _module, message) => { logs.push({ level, message }); }, error: async () => undefined };
  const auth = { isAuthenticated: () => authenticated, load: async () => undefined, getAccessToken: async () => "token", authenticate: async () => undefined, revoke: async () => undefined };
  const onSynced = jest.fn(async () => undefined);
  const sync = createBrowserSync({ auth, logger, timers, onSynced, createProvider: () => provider });
  return { provider, logs, auth, onSynced, sync };
}

beforeEach(() => fakeFiles.clear());

describe("createBrowserSync", () => {
  it("returns a skipped outcome while signed out instead of throwing", async () => {
    const { sync, provider } = harness(false);
    const list = jest.spyOn(provider, "list");

    expect(await sync.syncNow("manual")).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
    expect(browserSyncStatus(sync.status(), false)).toEqual({ connected: false, syncing: false, lastSyncTime: null, lastError: null });
    expect(list).not.toHaveBeenCalled();
  });

  it("joins a sync requested while one runs, and reports syncing meanwhile", async () => {
    const { sync, provider } = harness(true);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const resolveRoot = provider.resolveRoot.bind(provider);
    const calls = jest.fn();
    provider.resolveRoot = async (ns) => { calls(); await gate; return resolveRoot(ns); };

    const first = sync.syncNow("manual");
    const second = sync.syncNow("idle");
    while (calls.mock.calls.length === 0) await new Promise((resolve) => setImmediate(resolve));
    expect(browserSyncStatus(sync.status(), true).syncing).toBe(true);
    release();

    expect(await second).toBe(await first);
    expect((await first).kind).toBe("synced");
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after a successful sync and shows when it finished", async () => {
    const { sync, onSynced } = harness(true);
    const outcome = await sync.syncNow("manual");
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(outcome.kind === "synced" && browserSyncStatus(sync.status(), true).lastSyncTime).toBe(outcome.kind === "synced" && outcome.record.finishedAt);
  });

  it("keeps the error of a failed sync for the badge, logs it, and skips the rebuild", async () => {
    const { sync, provider, logs, onSynced } = harness(true);
    provider.setConnected(false);

    expect((await sync.syncNow("alarm")).kind).toBe("failed");

    expect(browserSyncStatus(sync.status(), true)).toMatchObject({ syncing: false, lastError: expect.stringContaining("not connected") });
    expect(logs).toContainEqual({ level: "ERROR", message: "Sync failed" });
    expect(onSynced).not.toHaveBeenCalled();
  });
});
