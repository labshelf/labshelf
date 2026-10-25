import { acquireFolderLease } from "../../../src/collab/mirror/openProjectLease";
import { MirrorOwnershipLost } from "../../../src/collab/mirror/mirrorLostError";
import { type LeaseScheduler } from "../../../src/collab/mirror/mirrorScheduler";
import { MemoryLibraryFs } from "../../support/memoryLibraryFs";
import { fakeLogger } from "../../support/fakeLogger";

const FOLDER = "/project";
const LEASE = "/project/.labshelf/mirror-lease.json";

function fakeScheduler(start = 1_000_000) {
  const state = { now: start, onDelay: async () => {}, tasks: [] as Array<{ ms: number; task: () => void; stopped: boolean }> };
  const scheduler: LeaseScheduler = {
    now: () => state.now,
    delay: async (ms) => { state.now += ms; await state.onDelay(); },
    every: (ms, task) => {
      const entry = { ms, task, stopped: false };
      state.tasks.push(entry);
      return () => { entry.stopped = true; };
    },
  };
  /** Runs every live periodic task once after moving the clock, and waits for it to settle. */
  const tick = async (ms = 10_000) => {
    state.now += ms;
    for (const t of state.tasks) { if (!t.stopped) { t.task(); } }
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { state, scheduler, tick };
}

function setup() {
  const fs = new MemoryLibraryFs();
  const logger = fakeLogger();
  const clock = fakeScheduler();
  const acquire = (takeOver = false) => acquireFolderLease({ fs, folder: FOLDER, app: "vscode", logger, scheduler: clock.scheduler, takeOver });
  const readLease = async () => JSON.parse(await fs.readText(LEASE)) as { owner: string; app: string; renewedAt: number; ttlMs: number };
  const writeForeign = (renewedAt: number) =>
    fs.writeText(LEASE, JSON.stringify({ owner: "other", app: "browser", renewedAt, ttlMs: 30_000 }));
  return { fs, logger, clock, acquire, readLease, writeForeign };
}

describe("acquireFolderLease", () => {
  it("owns a free folder after the confirmation read", async () => {
    const { acquire, readLease, clock } = setup();
    const result = await acquire();
    expect(result.kind).toBe("owned");
    const lease = await readLease();
    expect(lease).toMatchObject({ app: "vscode", renewedAt: 1_000_000, ttlMs: 30_000 });
    expect(clock.state.now).toBe(1_001_500);
    expect(clock.state.tasks.map((t) => t.ms)).toEqual([10_000]);
  });

  it("reports busy on an unexpired foreign lease and leaves it in place", async () => {
    const { acquire, readLease, writeForeign, clock } = setup();
    await writeForeign(clock.state.now - 29_000);
    expect(await acquire()).toEqual({ kind: "busy", holder: { app: "browser", renewedAt: clock.state.now - 29_000 } });
    expect((await readLease()).owner).toBe("other");
  });

  it("takes an expired foreign lease", async () => {
    const { acquire, readLease, writeForeign, clock } = setup();
    await writeForeign(clock.state.now - 31_000);
    expect((await acquire()).kind).toBe("owned");
    expect((await readLease()).app).toBe("vscode");
  });

  it("replaces a malformed lease file and logs a warning", async () => {
    const { fs, acquire, logger } = setup();
    await fs.writeText(LEASE, "{not json");
    expect((await acquire()).kind).toBe("owned");
    expect(logger.logs.filter((l) => l.level === "WARN")).toHaveLength(1);
  });

  it("loses to a writer that lands during the confirmation wait", async () => {
    const { acquire, writeForeign, clock } = setup();
    clock.state.onDelay = async () => { await writeForeign(clock.state.now); };
    expect(await acquire()).toEqual({ kind: "busy", holder: { app: "browser", renewedAt: 1_001_500 } });
    expect(clock.state.tasks).toEqual([]);
  });

  it("renews the lease every period", async () => {
    const { acquire, readLease, clock } = setup();
    await acquire();
    await clock.tick();
    expect((await readLease()).renewedAt).toBe(1_011_500);
  });

  it("reports loss when a foreign owner overwrites the lease", async () => {
    const { acquire, readLease, writeForeign, clock, fs } = setup();
    const result = await acquire();
    if (result.kind !== "owned") { throw new Error("expected owned"); }
    const lost = jest.fn();
    result.lease.onLost(lost);
    await writeForeign(clock.state.now);
    await expect(result.lease.assertOwned()).rejects.toBeInstanceOf(MirrorOwnershipLost);
    await clock.tick();
    expect(lost).toHaveBeenCalledTimes(1);
    expect((await readLease()).owner).toBe("other");
    expect(clock.state.tasks.every((t) => t.stopped)).toBe(true);
    await result.lease.release();
    expect(await fs.exists(LEASE)).toBe(true);
  });

  it("takes over an unexpired foreign lease when asked", async () => {
    const { acquire, readLease, writeForeign, clock } = setup();
    await writeForeign(clock.state.now);
    expect((await acquire(true)).kind).toBe("owned");
    expect((await readLease()).app).toBe("vscode");
  });

  it("deletes the lease file on release while it is ours", async () => {
    const { acquire, fs, clock } = setup();
    const result = await acquire();
    if (result.kind !== "owned") { throw new Error("expected owned"); }
    await result.lease.assertOwned();
    await result.lease.release();
    expect(await fs.exists(LEASE)).toBe(false);
    expect(clock.state.tasks.every((t) => t.stopped)).toBe(true);
  });
});
