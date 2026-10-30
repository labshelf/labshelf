/** Verifies the driver session lifecycle through createCellSessions against a fake driver: cancel, timeout and driver exit kills, restart, idle close and dispose. Runs and output are in cellSessions.test.ts. */
import { PY, R, delay, installDriverHooks, isAlive, makeSessions, pidOf, run, waitGone } from "./cellSessionsHarness";

jest.setTimeout(30_000);

installDriverHooks();

describe("createCellSessions", () => {
  test("1.3c cancel kills the process and answers cancelled", async () => {
    const { sessions } = makeSessions();
    const pid = await pidOf(sessions);
    const controller = new AbortController();
    const pending = run(sessions, "sleep 20000", "note-a", PY, { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    const result = await pending;
    expect(result.status).toBe("cancelled");
    expect(result.language).toBe(PY);
    expect(await waitGone(pid)).toBe(true);
  });

  test("1.3c the run after a cancel starts fresh and returns restarted true", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2");
    const pid = await pidOf(sessions);
    const controller = new AbortController();
    const pending = run(sessions, "sleep 20000", "note-a", PY, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await pending;
    const next = await run(sessions, "get x");
    expect(next.status).toBe("ok");
    expect(next.restarted).toBe(true);
    expect(next.text).toBe("undefined");
    expect(await pidOf(sessions)).not.toBe(pid);
    expect((await run(sessions, "echo again")).restarted).toBeFalsy();
  });

  test("1.3c a signal aborted before the run answers cancelled", async () => {
    const { sessions } = makeSessions();
    const controller = new AbortController();
    controller.abort();
    const result = await run(sessions, "echo never", "note-a", PY, { signal: controller.signal });
    expect(result.status).toBe("cancelled");
  });
});

describe("createCellSessions", () => {
  test("1.3c timeout kills the process and answers timeout", async () => {
    const { sessions } = makeSessions();
    const pid = await pidOf(sessions);
    const result = await run(sessions, "sleep 20000", "note-a", PY, { timeoutMs: 250 });
    expect(result.status).toBe("timeout");
    expect(result.language).toBe(PY);
    expect(await waitGone(pid)).toBe(true);
  });

  test("1.3c the run after a timeout starts fresh and returns restarted true", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2");
    const pid = await pidOf(sessions);
    await run(sessions, "sleep 20000", "note-a", PY, { timeoutMs: 250 });
    const next = await run(sessions, "get x");
    expect(next.status).toBe("ok");
    expect(next.restarted).toBe(true);
    expect(next.text).toBe("undefined");
    expect(await pidOf(sessions)).not.toBe(pid);
    expect((await run(sessions, "echo again")).restarted).toBeFalsy();
  });

  test("1.3c the first run of a key is not marked restarted", async () => {
    const { sessions } = makeSessions();
    expect((await run(sessions, "echo first")).restarted).toBeFalsy();
  });

  test("1.3c a cancel on one key leaves the other keys running", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 9", "note-b");
    const controller = new AbortController();
    const pending = run(sessions, "sleep 20000", "note-a", PY, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await pending;
    const other = await run(sessions, "get x", "note-b");
    expect(other.text).toBe("9");
    expect(other.restarted).toBeFalsy();
  });
});

describe("createCellSessions", () => {
  test("1.3c the timeout counts from the write of the request, not from spawn", async () => {
    const { sessions } = makeSessions({ launchDelayMs: 600 });
    const result = await run(sessions, "echo quick", "note-a", PY, { timeoutMs: 400 });
    expect(result.status).toBe("ok");
    expect(result.text).toBe("quick");
  });

  test("1.3c cancel kills the whole process tree", async () => {
    const { sessions } = makeSessions();
    const childPid = Number((await run(sessions, "child")).text);
    expect(isAlive(childPid)).toBe(true);
    const controller = new AbortController();
    const pending = run(sessions, "sleep 20000", "note-a", PY, { signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await pending;
    expect(await waitGone(childPid)).toBe(true);
  });

  test("1.3c a driver that exits on its own answers error with its stderr", async () => {
    const { sessions } = makeSessions();
    const pid = await pidOf(sessions);
    const result = await run(sessions, "exit 3");
    expect(result.status).toBe("error");
    expect(result.error).toContain("driver went away");
    expect(await waitGone(pid)).toBe(true);
  });

  test("1.3c the run after a driver exit starts fresh and returns restarted true", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2");
    await run(sessions, "exit 3");
    const next = await run(sessions, "get x");
    expect(next.status).toBe("ok");
    expect(next.restarted).toBe(true);
    expect(next.text).toBe("undefined");
    expect((await run(sessions, "echo again")).restarted).toBeFalsy();
  });
});

describe("createCellSessions", () => {
  test("1.3d restart kills the process without running anything", async () => {
    const { sessions, launches } = makeSessions();
    const pid = await pidOf(sessions);
    expect(launches).toHaveLength(1);
    await sessions.restart("note-a", PY);
    expect(await waitGone(pid)).toBe(true);
    expect(launches).toHaveLength(1);
  });

  test("1.3d the run after a restart starts fresh and returns restarted true", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2");
    const pid = await pidOf(sessions);
    await sessions.restart("note-a", PY);
    const next = await run(sessions, "get x");
    expect(next.status).toBe("ok");
    expect(next.restarted).toBe(true);
    expect(next.text).toBe("undefined");
    expect(await pidOf(sessions)).not.toBe(pid);
  });

  test("1.3d restart leaves other keys and languages alone", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 1", "note-b", PY);
    await run(sessions, "set x 2", "note-a", R);
    await run(sessions, "set x 3", "note-a", PY);
    await sessions.restart("note-a", PY);
    expect((await run(sessions, "get x", "note-b", PY)).text).toBe("1");
    expect((await run(sessions, "get x", "note-a", R)).text).toBe("2");
    expect((await run(sessions, "get x", "note-a", PY)).text).toBe("undefined");
  });

  test("1.3d restart of a key without a process resolves", async () => {
    const { sessions } = makeSessions();
    await expect(sessions.restart("never-ran", PY)).resolves.toBeUndefined();
  });
});

describe("createCellSessions", () => {
  test("1.3d an idle process is closed after idleMs", async () => {
    const { sessions } = makeSessions({ idleMs: 250 });
    const pid = await pidOf(sessions);
    expect(isAlive(pid)).toBe(true);
    expect(await waitGone(pid, 5_000)).toBe(true);
  });

  test("1.3d the idle timer restarts with each run", async () => {
    const { sessions } = makeSessions({ idleMs: 500 });
    const pid = await pidOf(sessions);
    await delay(300);
    await run(sessions, "echo keep");
    await delay(300);
    expect(isAlive(pid)).toBe(true);
    expect(await waitGone(pid, 5_000)).toBe(true);
  });

  test("1.3d a run longer than idleMs is not closed while running", async () => {
    const { sessions } = makeSessions({ idleMs: 150 });
    const result = await run(sessions, "sleep 600");
    expect(result.status).toBe("ok");
    expect(result.text).toBe("slept");
  });

  test("1.3d the run after an idle close works", async () => {
    const { sessions } = makeSessions({ idleMs: 150 });
    const pid = await pidOf(sessions);
    expect(await waitGone(pid, 5_000)).toBe(true);
    const next = await run(sessions, "echo back");
    expect(next.status).toBe("ok");
    expect(next.text).toBe("back");
  });
});

describe("createCellSessions", () => {
  test("1.3d dispose leaves no driver process", async () => {
    const { sessions } = makeSessions();
    const pids = [await pidOf(sessions, "note-a", PY), await pidOf(sessions, "note-b", PY), await pidOf(sessions, "note-a", R)];
    expect(pids.every(isAlive)).toBe(true);
    await sessions.dispose();
    expect(pids.some(isAlive)).toBe(false);
  });

  test("1.3d dispose kills the process tree of a driver", async () => {
    const { sessions } = makeSessions();
    const childPid = Number((await run(sessions, "child")).text);
    await sessions.dispose();
    expect(await waitGone(childPid)).toBe(true);
  });

  test("1.3d dispose with nothing running resolves", async () => {
    const { sessions } = makeSessions();
    await expect(sessions.dispose()).resolves.toBeUndefined();
  });

  test("1.3d dispose during a run ends the run without hanging", async () => {
    const { sessions } = makeSessions();
    const pid = await pidOf(sessions);
    const pending = run(sessions, "sleep 20000");
    await delay(150);
    await sessions.dispose();
    const result = await pending;
    expect(result.status).not.toBe("ok");
    expect(isAlive(pid)).toBe(false);
  });
});

describe("createCellSessions", () => {
  test("A3 cancel, timeout and restart each kill the driver and the next run is fresh with restarted", async () => {
    const { sessions } = makeSessions();
    const killers: Array<(pid: number) => Promise<void>> = [
      async () => {
        const controller = new AbortController();
        const pending = run(sessions, "sleep 20000", "note-a", PY, { signal: controller.signal });
        setTimeout(() => controller.abort(), 100);
        await pending;
      },
      async () => { await run(sessions, "sleep 20000", "note-a", PY, { timeoutMs: 200 }); },
      async () => { await sessions.restart("note-a", PY); },
    ];
    for (const kill of killers) {
      await run(sessions, "set x 2");
      const pid = await pidOf(sessions);
      await kill(pid);
      expect(await waitGone(pid)).toBe(true);
      const next = await run(sessions, "get x");
      expect(next.restarted).toBe(true);
      expect(next.text).toBe("undefined");
    }
  });
});
