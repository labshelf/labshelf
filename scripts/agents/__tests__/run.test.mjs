import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blockReason, main, summarizeCmd, summarizeJest, summarizeNodeTest, summarizeTsc } from "../run.mjs";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const saved = { ...process.env };
let dir;
let logs;
let runs;
let spool;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "run-"));
  logs = join(dir, "logs");
  runs = join(dir, "runs");
  spool = join(dir, "spool");
  process.env.LABSHELF_LOGS_DIR = logs;
  process.env.LABSHELF_RUNS_DIR = runs;
  process.env.LABSHELF_TELEMETRY_SPOOL = spool;
  delete process.env.LABSHELF_TELEMETRY;
  delete process.env.LABSHELF_PLAN;
  delete process.env.LABSHELF_SPEC;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

const events = () =>
  existsSync(spool)
    ? readdirSync(spool).flatMap((f) => readFileSync(join(spool, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)))
    : [];

// Runs main with a fake spawn; returns { code, lines, calls }.
async function run(argv, spawn) {
  const lines = [];
  const calls = [];
  const code = await main(argv, {
    root,
    out: (line) => lines.push(line),
    spawn: (command, args, options) => {
      calls.push({ command, args, options });
      return spawn(command, args, options);
    },
  });
  return { code, lines, calls };
}

const jestMessage = (expected, received) =>
  `\u001b[31mError: expect(received).toBe(expected) // Object.is equality\u001b[39m\n\nExpected: ${expected}\nReceived: ${received}\n` +
  "    at Object.toBe (/repo/node_modules/expect/build/index.js:10:5)\n" +
  "    at Object.<anonymous> (/repo/packages/core/__tests__/thing.test.ts:12:20)\n" +
  "    at helper (/repo/packages/core/src/thing/helper.ts:7:3)\n" +
  "    at Promise.then (node:internal/process:1:1)";

function jestJson(names) {
  return {
    numFailedTests: names.length,
    numTotalTests: names.length + 3,
    testResults: [
      {
        name: join(root, "packages/core/__tests__/thing.test.ts"),
        status: names.length ? "failed" : "passed",
        message: "",
        assertionResults: names.map((name, i) => ({
          fullName: name,
          title: name,
          status: "failed",
          failureMessages: [jestMessage(i, i + 1)],
        })),
      },
    ],
  };
}

// A fake jest: writes the --outputFile json for the failing names the call sequence gives.
function fakeJest(sequence) {
  let call = 0;
  return (command, args) => {
    const flag = args.find((a) => a.startsWith("--outputFile="));
    const failing = sequence[Math.min(call++, sequence.length - 1)];
    writeFileSync(flag.slice("--outputFile=".length), JSON.stringify(jestJson(failing)));
    return { status: failing.length ? 1 : 0, stdout: "raw jest stdout\n", stderr: "raw jest stderr\n" };
  };
}

const names = (n) => Array.from({ length: n }, (_, i) => `test ${i}`);

describe("summarizeJest", () => {
  it("prints failing names, expected/received and the first frame outside node_modules and tests", () => {
    const lines = summarizeJest(jestJson(["adds up"]), { root });
    const text = lines.join("\n");
    assert.match(text, /adds up/);
    assert.match(text, /Expected: 0/);
    assert.match(text, /Received: 1/);
    assert.match(text, /packages\/core\/src\/thing\/helper\.ts:7:3/);
    assert.doesNotMatch(text, /node_modules/);
    assert.doesNotMatch(text, /thing\.test\.ts:12/);
    assert.doesNotMatch(text, /\u001b/);
  });
});

describe("summarizeTsc", () => {
  it("groups TS errors by file and caps them at 20", () => {
    const text = Array.from({ length: 30 }, (_, i) => `packages/core/src/f${i % 6}.ts(${i + 1},3): error TS2322: Type 'x' is not assignable ${i}.`).join("\n");
    const lines = summarizeTsc(text);
    assert.equal(lines.filter((l) => /TS2322/.test(l)).length, 20);
    assert.ok(lines.some((l) => /f0\.ts/.test(l)));
    assert.ok(lines.length <= 36);
  });

  it("says so when there are no errors", () => {
    assert.match(summarizeTsc("").join("\n"), /no errors/i);
  });
});

const padded = (head, tail = []) => [...Array.from({ length: 80 }, (_, i) => `progress ${i}`), ...head, ...Array.from({ length: 80 }, (_, i) => `more progress ${i}`), ...tail].join("\n");

describe("summarizeCmd", () => {
  it("tsc log: keeps every error TS line and drops the progress lines", () => {
    const errors = ["src/a.ts(3,5): error TS2322: Type 'string' is not assignable to type 'number'.", "src/b.ts(9,1): error TS2304: Cannot find name 'x'."];
    const lines = summarizeCmd(padded(errors, ["Found 2 errors in 2 files."]));
    for (const e of errors) assert.ok(lines.includes(e), e);
    assert.ok(lines.includes("Found 2 errors in 2 files."));
    assert.ok(!lines.includes("progress 3"));
    assert.ok(lines.length <= 38);
  });

  it("jest log: keeps the failing test, expected/received and repo frames but not node_modules frames", () => {
    const failure = [
      "FAIL packages/core/__tests__/thing.test.ts",
      "  ● thing › adds up",
      "    expect(received).toBe(expected) // Object.is equality",
      "    Expected: 1",
      "    Received: 2",
      "      at Object.toBe (/repo/node_modules/expect/build/index.js:10:5)",
      "      at helper (/repo/packages/core/src/thing/helper.ts:7:3)",
      "      at Promise.then (node:internal/process:1:1)",
    ];
    const lines = summarizeCmd(padded(failure, ["Tests:       1 failed, 3 passed, 4 total"]));
    for (const l of failure.filter((x) => !/node_modules|node:/.test(x))) assert.ok(lines.includes(l), l);
    assert.ok(!lines.some((l) => l.includes("node_modules")));
    assert.ok(!lines.some((l) => l.includes("node:internal")));
    assert.ok(lines.includes("Tests:       1 failed, 3 passed, 4 total"));
  });

  it("node:test log: keeps the not ok lines and the error line, not the ok lines", () => {
    const tap = ["ok 1 - fine", "not ok 2 - breaks", "  ---", "  error: 'expected 1 got 2'", "  ..."];
    const lines = summarizeCmd(padded(tap, ["# tests 80", "# pass 79", "# fail 1"]));
    assert.ok(lines.includes("not ok 2 - breaks"));
    assert.ok(lines.includes("# fail 1"));
    assert.ok(!lines.includes("ok 1 - fine"));
  });

  it("eslint log: keeps the problem lines with their file and the problem count", () => {
    const eslint = ["/repo/src/a.ts", "  4:7  error  'x' is assigned a value but never used  no-unused-vars", "  5:1  warning  Unexpected console  no-console"];
    const lines = summarizeCmd(padded(eslint, ["✖ 2 problems (1 error, 1 warning)"]));
    assert.ok(lines.includes("/repo/src/a.ts"));
    assert.ok(lines.includes(eslint[1]));
    assert.ok(lines.includes("✖ 2 problems (1 error, 1 warning)"));
    assert.ok(!lines.includes(eslint[2]));
  });

  it("noisy build log: repeated lines are counted once and the output stays within 38 lines", () => {
    const noise = Array.from({ length: 300 }, (_, i) => (i % 3 === 0 ? "Error: asset missing" : `[webpack] compiling module ${i}`));
    const distinct = Array.from({ length: 100 }, (_, i) => `Error: failure number ${i}`);
    const lines = summarizeCmd([...noise, ...distinct, "build failed", "exit status 1"].join("\n"));
    assert.ok(lines.includes("Error: asset missing (x100)"));
    assert.ok(lines.length <= 38);
    assert.ok(lines.some((l) => /more distinct error lines/.test(l)));
    assert.ok(lines.includes("exit status 1"));
    assert.ok(!lines.some((l) => l.startsWith("[webpack]")));
  });

  it("counts error lines in the header", () => {
    const lines = summarizeCmd(padded(["Error: a", "Error: a", "Error: b"]));
    assert.match(lines[0], /3 error lines, 2 distinct/);
  });
});

describe("summarizeNodeTest", () => {
  const tap = [
    "TAP version 13",
    "# Subtest: fine",
    "ok 1 - fine",
    "  ---",
    "  duration_ms: 0.2",
    "  ...",
    "# Subtest: broken",
    "not ok 2 - broken",
    "  ---",
    "  failureType: 'testCodeFailure'",
    "  error: |-",
    "    Expected values to be strictly equal:",
    "    1 !== 2",
    "  code: 'ERR_ASSERTION'",
    "  ...",
    "1..2",
    "# tests 2",
    "# pass 1",
    "# fail 1",
  ].join("\n");

  it("prints totals, failing names and the first error line", () => {
    const { lines, failing } = summarizeNodeTest(tap);
    const text = lines.join("\n");
    assert.match(text, /2 tests, 1 passed, 1 failed/);
    assert.match(text, /broken/);
    assert.match(text, /Expected values to be strictly equal/);
    assert.deepEqual(failing, ["broken"]);
  });
});

describe("blockReason", () => {
  const r = (...failing) => failing.map((f) => ({ ts: "t", failing: f, exit: 1 }));

  it("is null for fewer than three runs", () => {
    assert.equal(blockReason(r(["a"], ["a"])), null);
  });
  it("blocks when the last two runs did not shrink the failing set", () => {
    assert.equal(blockReason(r(["a", "b"], ["a", "b"], ["a", "b"])), "no_progress");
  });
  it("does not block when the last run shrank", () => {
    assert.equal(blockReason(r(["a", "b", "c"], ["a", "b", "c"], ["a", "b"])), null);
  });
  it("blocks at five runs even when shrinking", () => {
    assert.equal(blockReason(r(["a", "b", "c", "d", "e", "f"], ["a", "b", "c", "d", "e"], ["a", "b", "c", "d"], ["a", "b", "c"], ["a", "b"])), "max_runs");
  });
});

describe("main", () => {
  it("jest: at most 40 lines, original exit code, log written, log path printed", async () => {
    const { code, lines, calls } = await run(["test", "core", "--", "__tests__/thing.test.ts"], fakeJest([names(60)]));
    assert.equal(code, 1);
    assert.ok(lines.length <= 40, `${lines.length} lines`);
    const logFiles = readdirSync(logs);
    assert.equal(logFiles.length, 1);
    assert.match(logFiles[0], /-test\.log$/);
    assert.match(readFileSync(join(logs, logFiles[0]), "utf8"), /raw jest stdout/);
    assert.ok(lines.join("\n").includes(join(logs, logFiles[0])));
    assert.equal(calls[0].command, "pnpm");
    assert.deepEqual(calls[0].args.slice(0, 4), ["--filter", "@labshelf/core", "test", "--json"]);
    assert.equal(calls[0].args.at(-1), "__tests__/thing.test.ts");
  });

  it("jest: passing run prints a short summary and exits 0", async () => {
    const { code, lines } = await run(["test", "core"], fakeJest([[]]));
    assert.equal(code, 0);
    assert.ok(lines.length <= 5);
  });

  it("typecheck: summarizes tsc output and keeps the exit code", async () => {
    const out = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts(1,1): error TS2322: bad ${i}`).join("\n");
    const { code, lines, calls } = await run(["typecheck", "core"], () => ({ status: 2, stdout: out, stderr: "" }));
    assert.equal(code, 2);
    assert.ok(lines.length <= 40);
    assert.deepEqual(calls[0].args, ["--filter", "@labshelf/core", "typecheck"]);
    assert.equal(readdirSync(logs).length, 1);
  });

  it("build: runs the package build and keeps the exit code", async () => {
    const { code, calls } = await run(["build", "core"], () => ({ status: 0, stdout: "built\n", stderr: "" }));
    assert.equal(code, 0);
    assert.deepEqual(calls[0].args, ["--filter", "@labshelf/core", "build"]);
  });

  it("tooling: runs node --test with the tap reporter on the given paths", async () => {
    const { code, calls } = await run(["test", "tooling", "--", "scripts/agents/__tests__/run.test.mjs"], () => ({ status: 0, stdout: "# tests 1\n# pass 1\n# fail 0\n", stderr: "" }));
    assert.equal(code, 0);
    assert.equal(calls[0].command, process.execPath);
    assert.deepEqual(calls[0].args, ["--test", "--test-reporter=tap", "scripts/agents/__tests__/run.test.mjs"]);
  });

  it("tooling: defaults to the test:tooling globs", async () => {
    const { calls } = await run(["test", "tooling"], () => ({ status: 0, stdout: "", stderr: "" }));
    assert.ok(calls[0].args.includes("scripts/*/__tests__/*.test.mjs"));
    assert.ok(calls[0].args.includes(".claude/hooks/__tests__/*.test.mjs"));
  });

  it("cmd: keeps the exit code and filters long output to its error lines and last lines", async () => {
    const out = Array.from({ length: 300 }, (_, i) => (i === 120 ? "Error: boom" : `line ${i}`)).join("\n");
    const { code, lines, calls } = await run(["cmd", "--", "echo", "hi"], () => ({ status: 7, stdout: out, stderr: "" }));
    assert.equal(code, 7);
    assert.ok(lines.length <= 40);
    assert.ok(lines.includes("Error: boom"));
    assert.ok(lines.includes("line 299"));
    assert.ok(!lines.includes("line 0"));
    assert.equal(calls[0].command, "echo");
    assert.deepEqual(calls[0].args, ["hi"]);
  });

  const logOf = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");
  const logPath = (lines) => lines.find((l) => l.startsWith("log: "))?.slice(5);

  it("cmd: a long log with no error lines shows the last lines and the log path, with at most 40 lines", async () => {
    const { code, lines } = await run(["cmd", "--", "make"], () => ({ status: 9, stdout: logOf(200), stderr: "" }));
    assert.equal(code, 9);
    assert.ok(lines.length <= 40);
    for (const i of [192, 199]) assert.ok(lines.includes(`line ${i}`), `line ${i}`);
    for (const i of [0, 100, 191]) assert.ok(!lines.includes(`line ${i}`), `line ${i}`);
    assert.ok(lines.some((l) => /no error lines/.test(l)));
    assert.ok(existsSync(logPath(lines)));
    assert.ok(readFileSync(logPath(lines), "utf8").includes("line 0"));
  });

  it("cmd: a log of at most 60 lines is printed as is", async () => {
    const { code, lines } = await run(["cmd", "--", "make"], () => ({ status: 1, stdout: logOf(60), stderr: "" }));
    assert.equal(code, 1);
    for (let i = 0; i < 60; i += 1) assert.ok(lines.includes(`line ${i}`));
    assert.ok(logPath(lines));
  });

  it("rejects an unknown kind or package with exit 2", async () => {
    assert.equal((await run(["nope"], () => ({ status: 0 }))).code, 2);
    assert.equal((await run(["test", "ghost"], () => ({ status: 0 }))).code, 2);
  });

  it("rejects --spec without a plan with exit 2", async () => {
    const { code, calls } = await run(["test", "core", "--spec", "2.1"], fakeJest([[]]));
    assert.equal(code, 2);
    assert.equal(calls.length, 0);
  });

  it("with --spec: records each run and emits test_run", async () => {
    const argv = ["test", "core", "--spec", "2.1", "--plan", "demo"];
    await run(argv, fakeJest([names(3)]));
    await run(argv, fakeJest([names(2)]));
    const state = JSON.parse(readFileSync(join(runs, "demo", "2.1.json"), "utf8"));
    assert.equal(state.length, 2);
    assert.equal(state[0].failing.length, 3);
    assert.equal(state[1].failing.length, 2);
    assert.equal(state[1].exit, 1);
    const testRuns = events().filter((e) => e.kind === "test_run");
    assert.deepEqual(testRuns.map((e) => [e.attempt, e.failing, e.exit]), [[1, 3, 1], [2, 2, 1]]);
  });

  it("without --spec: keeps no state and emits nothing", async () => {
    await run(["test", "core"], fakeJest([names(3)]));
    assert.equal(existsSync(runs), false);
    assert.equal(events().length, 0);
  });

  it("blocks after two non-shrinking runs: exit 3, nothing spawned, test_blocked emitted", async () => {
    const argv = ["test", "core", "--spec", "2.1", "--plan", "demo"];
    for (let i = 0; i < 3; i += 1) assert.equal((await run(argv, fakeJest([names(3)]))).code, 1);
    const blocked = await run(argv, fakeJest([names(3)]));
    assert.equal(blocked.code, 3);
    assert.equal(blocked.calls.length, 0);
    assert.ok(blocked.lines.join("\n").includes("BLOCKED: return report status blocked_tests"));
    const event = events().find((e) => e.kind === "test_blocked");
    assert.equal(event.reason, "no_progress");
    assert.equal(event.attempt, 3);
    assert.equal(JSON.parse(readFileSync(join(runs, "demo", "2.1.json"), "utf8")).length, 3);
  });

  it("keeps running while the failing set shrinks, then blocks at five runs", async () => {
    const argv = ["test", "core", "--spec", "2.1", "--plan", "demo"];
    for (const n of [6, 5, 4, 3, 2]) assert.equal((await run(argv, fakeJest([names(n)]))).code, 1);
    const blocked = await run(argv, fakeJest([names(1)]));
    assert.equal(blocked.code, 3);
    assert.equal(blocked.calls.length, 0);
    assert.equal(events().find((e) => e.kind === "test_blocked").reason, "max_runs");
  });

  it("a different spec has its own counter", async () => {
    for (let i = 0; i < 3; i += 1) await run(["test", "core", "--spec", "a", "--plan", "demo"], fakeJest([names(3)]));
    assert.equal((await run(["test", "core", "--spec", "b", "--plan", "demo"], fakeJest([names(3)]))).code, 1);
  });
});
