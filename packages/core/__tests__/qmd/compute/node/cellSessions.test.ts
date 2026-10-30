/** Verifies createCellSessions through ICellRunner against a fake driver: shared state per (note key, language), output capture, the ready handshake and the missing status. Lifecycle (cancel, timeout, restart, idle, dispose) is in cellSessions.lifecycle.test.ts. */
import { promises as fs } from "node:fs";
import * as path from "node:path";

import { createCellSessions } from "../../../../src/qmd/compute/node/cellSessions";
import { fakeLogger } from "../../../support/fakeLogger";
import { MATH, PY, R, dirs, installDriverHooks, makeSessions, pidOf, run, track } from "./cellSessionsHarness";

jest.setTimeout(30_000);

installDriverHooks();

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
});

describe("createCellSessions", () => {
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
    expect(await fs.realpath(result.text ?? "")).toBe(dirs.cwdDir);
  });

  test("1.3a spawns with PYTHONIOENCODING utf-8 and the launch env", async () => {
    const { sessions } = makeSessions({ env: { LABSHELF_TEST_VAR: "from-launch" } });
    expect((await run(sessions, "env PYTHONIOENCODING")).text).toBe("utf-8");
    expect((await run(sessions, "env LABSHELF_TEST_VAR")).text).toBe("from-launch");
  });
});

describe("createCellSessions", () => {
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
});

describe("createCellSessions", () => {
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
});

describe("createCellSessions", () => {
  test("2.2 a launch with ready keeps the output printed before the ready line out of the first cell", async () => {
    const readyDriver = path.join(dirs.workDir, "readyDriver.js");
    await fs.writeFile(readyDriver, String.raw`
const readline = require("node:readline");
const SENT = "\u0001LABSHELF\u0001";
process.stderr.write("licence banner\n");
process.stdout.write("startup noise\n");
setTimeout(() => {
  process.stderr.write("late banner\n");
  process.stdout.write(SENT + JSON.stringify({ ready: true }) + "\n");
  // Like the Wolfram kernel, the driver reads requests only once it has started.
  readline.createInterface({ input: process.stdin }).on("line", (line) => {
    const req = JSON.parse(line);
    process.stdout.write(SENT + JSON.stringify({ id: req.id, text: "answer" }) + "\n");
  });
}, 100);
`, "utf8");
    const logger = fakeLogger();
    const sessions = createCellSessions({ logger, launch: async () => ({ command: process.execPath, args: [readyDriver], ready: true }) });
    track(sessions);
    const first = await run(sessions, "anything");
    expect(first.status).toBe("ok");
    expect(first.text).toBe("answer");
    expect(logger.logs.some((entry) => entry.level === "INFO" && entry.message.includes("before it was ready"))).toBe(true);
  });
});
