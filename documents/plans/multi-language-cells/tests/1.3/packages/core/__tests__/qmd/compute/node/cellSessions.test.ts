/** Verifies createCellSessions through ICellRunner against a fake driver: shared state per (note key, language), output capture, cancel/timeout/restart kills, idle close, dispose and the missing status. */
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import type { CellLanguage } from "../../../../src/qmd/compute/cellLanguage";
import type { ICellRunner } from "../../../../src/qmd/compute/cellRunner";
import { createCellSessions, type DriverLaunch } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";

type RunResult = Awaited<ReturnType<ICellRunner["run"]>>;

const PY = "python" as CellLanguage;
const R = "r" as CellLanguage;
const MATH = "mathematica" as CellLanguage;

jest.setTimeout(30_000);

// The fake driver speaks the D3 protocol: JSON lines {id, code} in, "\u0001LABSHELF\u0001" + JSON {id, text|latex|error} out, exit on stdin EOF.
const DRIVER_SOURCE = String.raw`
const readline = require("node:readline");
const { spawn } = require("node:child_process");
const SENT = "\u0001LABSHELF\u0001";
const vars = {};
let eol = "\n";
function reply(obj) { process.stdout.write(SENT + JSON.stringify(obj) + eol); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function handle(line) {
  const req = JSON.parse(line);
  const id = req.id;
  const words = String(req.code).trim().split(" ");
  const cmd = words[0];
  const rest = words.slice(1);
  if (cmd === "set") { vars[rest[0]] = rest[1]; reply({ id, text: "set" }); }
  else if (cmd === "get") { reply({ id, text: vars[rest[0]] === undefined ? "undefined" : vars[rest[0]] }); }
  else if (cmd === "echo") { reply({ id, text: rest.join(" ") }); }
  else if (cmd === "print") { process.stdout.write(rest.join(" ") + eol); reply({ id, text: "done" }); }
  else if (cmd === "printerr") { process.stderr.write(rest.join(" ") + "\n"); reply({ id, text: "done" }); }
  else if (cmd === "crlf") { eol = "\r\n"; process.stdout.write("crlfline" + eol); reply({ id, text: "done" }); }
  else if (cmd === "sleep") { await sleep(Number(rest[0])); reply({ id, text: "slept" }); }
  else if (cmd === "pid") { reply({ id, text: String(process.pid) }); }
  else if (cmd === "cwd") { reply({ id, text: process.cwd() }); }
  else if (cmd === "env") { reply({ id, text: String(process.env[rest[0]]) }); }
  else if (cmd === "latex") { reply({ id, latex: rest.join(" ") }); }
  else if (cmd === "fail") { reply({ id, error: rest.join(" ") }); }
  else if (cmd === "child") {
    const c = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    reply({ id, text: String(c.pid) });
  }
  else if (cmd === "exit") { process.stderr.write("fatal: driver went away\n"); process["exit"](Number(rest[0])); }
  else { reply({ id, error: "unknown command " + cmd }); }
}
let chain = Promise.resolve();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => { chain = chain.then(() => handle(line)); });
rl.on("close", () => process["exit"](0));
`;

let workDir: string;
let driverPath: string;
let cwdDir: string;
const live: ICellRunner[] = [];

beforeAll(async () => {
  workDir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "labshelf-sessions-")));
  driverPath = path.join(workDir, "driver.js");
  await fs.writeFile(driverPath, DRIVER_SOURCE, "utf8");
  cwdDir = path.join(workDir, "cwd");
  await fs.mkdir(cwdDir);
});

afterEach(async () => {
  await Promise.all(live.splice(0, live.length).map((sessions) => sessions.dispose().catch(() => undefined)));
});

afterAll(async () => {
  await fs.rm(workDir, { recursive: true, force: true });
});

interface Harness { sessions: ICellRunner; launches: CellLanguage[] }

function makeSessions(options: { idleMs?: number; launchDelayMs?: number; env?: Record<string, string>; missing?: CellLanguage[] } = {}): Harness {
  const launches: CellLanguage[] = [];
  const sessions = createCellSessions({
    ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }),
    logger: fakeLogger(),
    launch: async (language): Promise<DriverLaunch | undefined> => {
      launches.push(language);
      if (options.launchDelayMs) { await new Promise((resolve) => setTimeout(resolve, options.launchDelayMs)); }
      if (options.missing?.includes(language)) { return undefined; }
      return { command: process.execPath, args: [driverPath], ...(options.env ? { env: options.env } : {}) };
    },
  });
  live.push(sessions);
  return { sessions, launches };
}

function run(sessions: ICellRunner, code: string, key = "note-a", language: CellLanguage = PY, extra: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<RunResult> {
  return sessions.run({ code, language, noteKey: key }, { cwd: cwdDir, signal: extra.signal ?? new AbortController().signal, timeoutMs: extra.timeoutMs ?? 10_000 });
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function waitGone(pid: number, withinMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + withinMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) { return true; }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isAlive(pid);
}

const pidOf = async (sessions: ICellRunner, key = "note-a", language: CellLanguage = PY): Promise<number> => Number((await run(sessions, "pid", key, language)).text);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("createCellSessions", () => {
  test("1.3a two runs on one key share state in the driver", async () => {
    const { sessions } = makeSessions();
    const set = await run(sessions, "set x 2");
    const got = await run(sessions, "get x");
    expect(set.status).toBe("ok");
    expect(got.status).toBe("ok");
    expect(got.text).toBe("2");
    expect(got.language).toBe(PY);
    expect(typeof got.durationMs).toBe("number");
  });

  test("1.3a two note keys do not share state", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2", "note-a");
    const other = await run(sessions, "get x", "note-b");
    expect(other.text).toBe("undefined");
    expect(await pidOf(sessions, "note-a")).not.toBe(await pidOf(sessions, "note-b"));
  });

  test("1.3a two languages of one note key do not share state", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2", "note-a", PY);
    const other = await run(sessions, "get x", "note-a", R);
    expect(other.text).toBe("undefined");
    expect(other.language).toBe(R);
  });

  test("1.3a starts no process until the first run and launches once per key", async () => {
    const { sessions, launches } = makeSessions();
    expect(launches).toEqual([]);
    await run(sessions, "set x 1", "note-a", MATH);
    await run(sessions, "get x", "note-a", MATH);
    expect(launches).toEqual([MATH]);
    await run(sessions, "get x", "note-b", MATH);
    expect(launches).toEqual([MATH, MATH]);
  });

  test("1.3a serialises concurrent runs on one key in request order", async () => {
    const { sessions } = makeSessions();
    const [set, got, slept, after] = await Promise.all([
      run(sessions, "set x 7"),
      run(sessions, "get x"),
      run(sessions, "sleep 100"),
      run(sessions, "echo after"),
    ]);
    expect(set.status).toBe("ok");
    expect(got.text).toBe("7");
    expect(slept.text).toBe("slept");
    expect(after.text).toBe("after");
  });

  test("1.3a returns the latex of a response line", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "latex x^{2}");
    expect(result.status).toBe("ok");
    expect(result.latex).toBe("x^{2}");
  });

  test("1.3a returns the error of a response line as status error", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "fail boom happened");
    expect(result.status).toBe("error");
    expect(result.error).toContain("boom happened");
    expect((await run(sessions, "echo still-alive")).text).toBe("still-alive");
  });

  test("1.3a spawns the driver in the working directory of the run", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "cwd");
    expect(await fs.realpath(result.text ?? "")).toBe(cwdDir);
  });

  test("1.3a spawns with PYTHONIOENCODING utf-8 and the launch env", async () => {
    const { sessions } = makeSessions({ env: { LABSHELF_TEST_VAR: "from-launch" } });
    expect((await run(sessions, "env PYTHONIOENCODING")).text).toBe("utf-8");
    expect((await run(sessions, "env LABSHELF_TEST_VAR")).text).toBe("from-launch");
  });

  test("1.3b prints before the response line end up in the result text", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "print hello world");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("hello world");
    expect(result.text).toContain("done");
    expect((result.text ?? "").indexOf("hello world")).toBeLessThan((result.text ?? "").indexOf("done"));
  });

  test("1.3b stderr lines before the response end up in the result text", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "printerr careful now");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("careful now");
  });

  test("1.3b prints do not break the next run", async () => {
    const { sessions } = makeSessions();
    await run(sessions, "set x 2");
    await run(sessions, "print noise");
    await run(sessions, "printerr more noise");
    const next = await run(sessions, "get x");
    expect(next.status).toBe("ok");
    expect(next.text).toBe("2");
  });

  test("1.3b splits lines on CRLF as well as LF", async () => {
    const { sessions } = makeSessions();
    const result = await run(sessions, "crlf", "crlf-note");
    expect(result.status).toBe("ok");
    expect(result.text).toContain("crlfline");
    expect(result.text).toContain("done");
    expect(result.text).not.toContain("\r");
    expect((await run(sessions, "echo next", "crlf-note")).text).toBe("next");
  });

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

  test("1.3e launch undefined gives status missing with the language", async () => {
    const { sessions } = makeSessions({ missing: [R] });
    const result = await run(sessions, "echo hi", "note-a", R);
    expect(result.status).toBe("missing");
    expect(result.language).toBe(R);
  });

  test("1.3e a missing language does not affect the others", async () => {
    const { sessions } = makeSessions({ missing: [MATH] });
    expect((await run(sessions, "echo hi", "note-a", MATH)).status).toBe("missing");
    const py = await run(sessions, "echo hi", "note-a", PY);
    expect(py.status).toBe("ok");
    expect(py.text).toBe("hi");
  });

  test("1.3e launch is asked for the language of the run", async () => {
    const { sessions, launches } = makeSessions({ missing: [R, MATH] });
    await run(sessions, "echo hi", "note-a", R);
    await run(sessions, "echo hi", "note-a", MATH);
    expect(launches).toEqual([R, MATH]);
  });

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
