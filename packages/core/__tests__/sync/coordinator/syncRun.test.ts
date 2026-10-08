import { readSyncRunRecord } from "@labshelf/core";
import { runSyncOnce, type SyncRunInput } from "../../../src/sync/coordinator/syncRun.js";
import { coordinatorHarness, foreignLock, LAST_RUN_PATH, LOCK_PATH, START, type Harness } from "../../support/coordinatorHarness.js";
import { MemoryFileSystem } from "../../support/syncFakes.js";

function input(h: Harness, overrides: Partial<SyncRunInput> = {}): SyncRunInput {
  return {
    target: h.target,
    owner: { app: "test", pid: 1, host: "laptop" },
    createProvider: () => h.provider,
    logger: h.logger,
    source: "test/sync",
    clock: () => new Date(h.now()),
    ...overrides,
  };
}

describe("runSyncOnce", () => {
  it("holds the lock while the engine runs and releases it afterwards", async () => {
    const h = coordinatorHarness();
    h.fs.seed("/lib/papers/a/paper.pdf", "PDF");
    let heldDuringRun = false;
    const list = h.provider.list.bind(h.provider);
    h.provider.list = async (id) => { heldDuringRun ||= h.lockStore.files.has(LOCK_PATH); return list(id); };

    const attempt = await runSyncOnce(input(h));

    expect(attempt.ran).toBe(true);
    expect(heldDuringRun).toBe(true);
    expect(h.lockStore.files.has(LOCK_PATH)).toBe(false);
  });

  it("reports the holder and touches nothing when another app holds the lock", async () => {
    const h = coordinatorHarness();
    h.lockStore.files.set(LOCK_PATH, foreignLock(START));
    const list = jest.spyOn(h.provider, "list");

    const attempt = await runSyncOnce(input(h));

    expect(attempt).toEqual({ ran: false, holder: expect.objectContaining({ app: "vscode" }) });
    expect(list).not.toHaveBeenCalled();
  });

  it("runs without a lock when the target has none", async () => {
    const h = coordinatorHarness();
    const { lock: _lock, ...unlocked } = h.target;
    const attempt = await runSyncOnce(input(h, { target: unlocked }));
    expect(attempt.ran).toBe(true);
  });

  it("records the run for the other apps, stamped by the injected clock", async () => {
    const h = coordinatorHarness();
    h.fs.seed("/lib/papers/a/paper.pdf", "PDF");

    await runSyncOnce(input(h));

    expect(await readSyncRunRecord(h.fs, LAST_RUN_PATH)).toMatchObject({
      app: "test", host: "laptop", uploaded: 1, finishedAt: new Date(START).toISOString(),
    });
  });

  it("writes no record when the target has no run-record path", async () => {
    const h = coordinatorHarness();
    await runSyncOnce(input(h, { target: { ...h.target, state: { fs: h.fs, manifestPath: "/m.json" } } }));
    expect(h.fs.has(LAST_RUN_PATH)).toBe(false);
  });

  it("keeps the sync successful when the run record cannot be written, and warns", async () => {
    const h = coordinatorHarness();
    const state = new MemoryFileSystem();
    const write = state.writeFile.bind(state);
    state.writeFile = async (path, content) => {
      if (path === LAST_RUN_PATH) throw new Error("disk full");
      return write(path, content);
    };

    const attempt = await runSyncOnce(input(h, { target: { ...h.target, state: { fs: state, manifestPath: "/m.json", lastRunPath: LAST_RUN_PATH } } }));

    expect(attempt.ran).toBe(true);
    expect(h.logs).toContainEqual(expect.objectContaining({
      level: "WARN", message: "Could not write the sync run record", context: expect.objectContaining({ message: "disk full" }),
    }));
  });

  it("names Drive paper folders after the titles it is given", async () => {
    const h = coordinatorHarness();
    h.fs.seed("/lib/papers/vaswani2017/paper.pdf", "PDF");

    await runSyncOnce(input(h, { listTitles: async () => [["vaswani2017", "Attention Is All You Need"]] }));

    const root = await h.provider.resolveRoot("library");
    expect((await h.provider.list(root.id)).map((f) => f.name)).toEqual(["Attention Is All You Need"]);
  });

  it("keeps local folder names on Drive without titles", async () => {
    const h = coordinatorHarness();
    h.fs.seed("/lib/papers/vaswani2017/paper.pdf", "PDF");

    await runSyncOnce(input(h));

    const root = await h.provider.resolveRoot("library");
    expect((await h.provider.list(root.id)).map((f) => f.name)).toEqual(["vaswani2017"]);
  });

  it("hands its logger to the engine", async () => {
    const h = coordinatorHarness();
    h.fs.seed("/lib/papers/bad/paper.pdf", "PDF");
    const listDir = h.fs.listDir.bind(h.fs);
    h.fs.listDir = async (dir) => { if (dir === "/lib/papers/bad") throw new Error("EACCES"); return listDir(dir); };

    await runSyncOnce(input(h));

    expect(h.logs).toContainEqual(expect.objectContaining({ level: "WARN", module: "sync/treeScan" }));
  });
});
