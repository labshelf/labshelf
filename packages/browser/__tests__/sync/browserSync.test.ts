jest.mock("webextension-polyfill", () => ({ storage: { local: { get: async () => ({}), set: async () => undefined } } }));
jest.mock("../../src/storage/idb/db", () => ({ getDb: async () => require("../support/fakeIdb").fakeDb }));

import { driveStatusOf, type ILogger, type SyncTimers } from "@labshelf/core";
import { FakeRemoteProvider } from "@labshelf/core/test-support/sync-fakes";

import { createBrowserSync } from "../../src/sync";
import { clearFakeDb, fakeRows, putFile, textAt } from "../support/fakeIdb";

const timers: SyncTimers = { start: () => undefined, cancel: () => undefined };

function harness(authenticated: boolean, provider = new FakeRemoteProvider()) {
  const logs: Array<{ level: string; message: string }> = [];
  const logger: ILogger = { log: async (level, _module, message) => { logs.push({ level, message }); }, error: async () => undefined };
  const auth = { isAuthenticated: () => authenticated, load: async () => undefined, getAccessToken: async () => "token", authenticate: async () => undefined, revoke: async () => undefined };
  const onSynced = jest.fn(async () => undefined);
  const sync = createBrowserSync({ auth, logger, timers, onSynced, createProvider: () => provider });
  return { provider, logs, auth, onSynced, sync };
}

beforeEach(() => clearFakeDb());

describe("createBrowserSync", () => {
  it("returns a skipped outcome while signed out instead of throwing", async () => {
    const { sync, provider } = harness(false);
    const list = jest.spyOn(provider, "list");

    expect(await sync.syncNow("manual")).toEqual({ kind: "skipped", reason: "not signed in to Google Drive" });
    expect(driveStatusOf(sync.status(), false)).toEqual({ connected: false, syncing: false, lastSyncTime: null, lastError: null });
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
    expect(driveStatusOf(sync.status(), true).syncing).toBe(true);
    release();

    expect(await second).toBe(await first);
    expect((await first).kind).toBe("synced");
    expect(calls).toHaveBeenCalledTimes(2);
  });

  it("rebuilds after a successful sync and shows when it finished", async () => {
    const { sync, onSynced } = harness(true);
    const outcome = await sync.syncNow("manual");
    expect(onSynced).toHaveBeenCalledTimes(1);
    expect(outcome.kind === "synced" && driveStatusOf(sync.status(), true).lastSyncTime).toBe(outcome.kind === "synced" && outcome.record.finishedAt);
  });

  it("keeps the error of a failed sync for the badge, logs it, and skips the rebuild", async () => {
    const { sync, provider, logs, onSynced } = harness(true);
    provider.setConnected(false);

    expect((await sync.syncNow("alarm")).kind).toBe("failed");

    expect(driveStatusOf(sync.status(), true)).toMatchObject({ syncing: false, lastError: expect.stringContaining("not connected") });
    expect(logs).toContainEqual({ level: "ERROR", message: "Sync failed" });
    expect(onSynced).not.toHaveBeenCalled();
  });
});

// A paper in the IndexedDB library: its files and its cached record, as the capture flow leaves them.
function addPaper(id: string, title: string | undefined): void {
  putFile(`papers/${id}/metadata.yaml`, `citekey: ${id}\n${title ? `title: ${title}\n` : ""}`);
  putFile(`papers/${id}/paper.pdf`, "%PDF-1");
  if (title) { fakeRows.metadata.set(id, { paperId: id, record: { id, title }, folderPath: `papers/${id}` }); }
}

async function driveFolders(provider: FakeRemoteProvider): Promise<Array<{ id: string; name: string }>> {
  const root = await provider.resolveRoot("library");
  return (await provider.list(root.id)).filter((f) => f.isFolder).map(({ id, name }) => ({ id, name }));
}

describe("browser sync and the other apps' Drive layout", () => {
  it("names a new paper's Drive folder after its title", async () => {
    addPaper("vaswani2017", "Attention Is All You Need");
    const { sync, provider } = harness(true);
    expect((await sync.syncNow("manual")).kind).toBe("synced");
    expect((await driveFolders(provider)).map((f) => f.name)).toEqual(["Attention Is All You Need"]);
  });

  it("keeps the last run across a service-worker restart", async () => {
    const { sync, provider } = harness(true);
    const outcome = await sync.syncNow("manual");
    const restarted = harness(true, provider).sync;
    const status = await restarted.init();
    expect(status.lastRun?.finishedAt).toBe(outcome.kind === "synced" ? outcome.record.finishedAt : "unreachable");
    expect(status.lastRun?.app).toBe("browser");
  });

  it("keeps using a folder it created under the paper id before it knew titles", async () => {
    addPaper("vaswani2017", undefined);
    const { sync, provider } = harness(true);
    await sync.syncNow("manual");
    const [idFolder] = await driveFolders(provider);
    expect(idFolder?.name).toBe("vaswani2017");

    // The paper gets its title, a file is added here, and another device drops a file into the same Drive folder.
    fakeRows.metadata.set("vaswani2017", { paperId: "vaswani2017", record: { id: "vaswani2017", title: "Attention" }, folderPath: "papers/vaswani2017" });
    putFile("papers/vaswani2017/notes.md", "local note");
    await provider.upload(idFolder!.id, "remote.md", new TextEncoder().encode("remote note"));
    await sync.syncNow("manual");

    expect(await driveFolders(provider)).toEqual([idFolder]);
    expect((await provider.list(idFolder!.id)).map((f) => f.name).sort()).toEqual(["metadata.yaml", "notes.md", "paper.pdf", "remote.md"]);
    expect(textAt("papers/vaswani2017/remote.md")).toBe("remote note");
  });
});
