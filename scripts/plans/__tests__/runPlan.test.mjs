import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";

const runner = fileURLToPath(new URL("../runPlan.mjs", import.meta.url));
const PLAN = "documents/plans/demo";

// A stand-in for the `claude` binary: prints the stream-json events of a session, deletes the session file (or marks it
// carried when its id is in FAKE_CARRY), commits, leaves notes.txt changed when its id is in FAKE_DIRTY, and records its
// arguments, system prompt and environment in FAKE_LOG.
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
const prompt = args[1];
const match = /^\\/orchestrate (\\S+)\\/plan\\.(md|yaml) session (\\S+)$/.exec(prompt ?? "");
if (!match) { console.log(JSON.stringify({ type: "result", is_error: false, result: "OK" })); process.exit(0); }
const [, dir, format, id] = match;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt, system: args[args.indexOf("--append-system-prompt") + 1], runId: process.env.LABSHELF_PLAN_RUN_ID, plan: process.env.LABSHELF_PLAN, session: process.env.LABSHELF_PLAN_SESSION, noBackground: process.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS, bashTimeout: process.env.BASH_DEFAULT_TIMEOUT_MS }) + "\\n");
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sid-" + id, model: "fake-model" }));
const file = dir + "/sessions/" + id + "." + format;
if ((process.env.FAKE_CARRY ?? "").split(",").includes(id)) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: (pending|carried)$/m, "status: carried"));
} else fs.rmSync(file);
execFileSync("git", ["add", "-A"]);
execFileSync("git", ["commit", "-q", "--allow-empty", "-m", "session " + id]);
if ((process.env.FAKE_DIRTY ?? "").split(",").includes(id)) fs.appendFileSync("notes.txt", "left by " + id + "\\n");
console.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.5, result: "done " + id }));
`;

let tmp, repo, spool;
const write = (rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};
const commitAll = () => {
  execFileSync("git", ["add", "-A"], { cwd: repo });
  execFileSync("git", ["commit", "-q", "-m", "plan"], { cwd: repo });
};

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "run-plan-"));
  repo = join(tmp, "repo");
  mkdirSync(repo);
  spool = join(tmp, "spool");
  execFileSync("git", ["init", "-q", "-b", "work"], { cwd: repo });
  execFileSync("git", ["config", "user.email", "t@example.com"], { cwd: repo });
  execFileSync("git", ["config", "user.name", "T"], { cwd: repo });
  mkdirSync(join(tmp, "bin"));
  writeFileSync(join(tmp, "bin", "claude"), FAKE_CLAUDE);
  chmodSync(join(tmp, "bin", "claude"), 0o755);
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

// Rows are [id, status, depends_on].
const yamlPlan = (rows, status = "approved") => {
  const dir = planNew(repo, { slug: "demo", level: "N2" });
  rmSync(join(dir, "sessions", "1.yaml"));
  write(`${PLAN}/plan.yaml`, readFileSync(join(dir, "plan.yaml"), "utf8").replace("status: draft", `status: ${status}`));
  for (const [id, sessionStatus, depends_on = []] of rows) saveSession(dir, { id, goal: "g", depends_on, owns: [], status: sessionStatus, packages: [] });
  write("notes.txt", "notes\n");
  commitAll();
};

const mdPlan = (names, status = "approved") => {
  write(`${PLAN}/plan.md`, `# Plan\n\nStatus: ${status}\n`);
  for (const name of names) write(`${PLAN}/sessions/${name}.md`, "# session\n");
  commitAll();
};

// The two variables the runner defaults are dropped from the parent environment unless a test sets them.
const { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: _noBackground, BASH_DEFAULT_TIMEOUT_MS: _bashTimeout, ...parentEnv } = process.env;
const run = (args, env = {}) =>
  spawnSync("node", [runner, PLAN, ...args], {
    encoding: "utf8",
    env: { ...parentEnv, LABSHELF_PLAN_ROOT: repo, LABSHELF_TELEMETRY_SPOOL: spool, PATH: `${join(tmp, "bin")}:${process.env.PATH}`, FAKE_LOG: join(tmp, "fake.log"), ...env },
  });

const fakeCalls = () => (existsSync(join(tmp, "fake.log")) ? readFileSync(join(tmp, "fake.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const events = () => (existsSync(spool) ? readdirSync(spool).flatMap((f) => readFileSync(join(spool, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : []);
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

describe("runPlan --dry-run", () => {
  it("prints a YAML plan in depends_on order, never leaving out a session whose dependency is unfinished, and spawns nothing", () => {
    yamlPlan([
      ["10", "pending"],
      ["2", "pending", ["10"]],
      ["3", "blocked"],
      ["4", "pending", ["3"]],
      ["5", "pending", ["4"]],
    ]);
    const before = head();
    const out = run(["--dry-run"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /demo: 5 sessions pending: 3, 4, 5, 10, 2\n/);
    assert.doesNotMatch(out.stdout, /skipped|not run/);
    assert.deepEqual(fakeCalls(), []);
    assert.deepEqual(events(), []);
    assert.equal(head(), before);
  });

  it("prints an .md plan as 1, 2, 2b, 10", () => {
    mdPlan(["10", "2b", "1", "2"]);
    const out = run(["--dry-run"]);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /demo: 4 sessions pending: 1, 2, 2b, 10\n/);
    assert.doesNotMatch(out.stdout, /skipped/);
    assert.deepEqual(fakeCalls(), []);
  });

  it("refuses a plan that is not approved", () => {
    yamlPlan([["1", "pending"]], "draft");
    const out = run(["--dry-run"]);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /plan status is "draft"/);
  });

  it("accepts in_progress for a YAML plan", () => {
    yamlPlan([["1", "pending"]], "in_progress");
    assert.equal(run(["--dry-run"]).status, 0);
  });
});

describe("runPlan on a YAML plan", () => {
  it("runs the session with background tasks off and a 10 min Bash timeout", () => {
    yamlPlan([["1", "pending"]]);
    assert.equal(run([]).status, 0);
    assert.deepEqual(fakeCalls().map((c) => [c.noBackground, c.bashTimeout]), [["1", "600000"]]);
  });

  it("keeps the background and Bash timeout values the parent environment already sets", () => {
    yamlPlan([["1", "pending"]]);
    assert.equal(run([], { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0", BASH_DEFAULT_TIMEOUT_MS: "120000" }).status, 0);
    assert.deepEqual(fakeCalls().map((c) => [c.noBackground, c.bashTimeout]), [["0", "120000"]]);
  });

  it("retries an unfinished session, carries it to its dependent, keeps the queue going, and gives it one more run at the end", () => {
    yamlPlan([
      ["1", "pending"],
      ["2", "pending", ["1"]],
      ["3", "pending", ["2"]],
      ["4", "pending"],
      ["10", "pending", ["4"]],
    ]);
    const out = run(["--max-budget-usd", "3", "--model", "sonnet"], { FAKE_CARRY: "2" });
    assert.equal(out.status, 0, out.stdout + out.stderr);

    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "2", "2", "2", "3", "4", "10", "2"]);
    assert.equal(calls[0].prompt, `/orchestrate ${PLAN}/plan.yaml session 1`);
    const args = calls[0].args;
    assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
    assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
    assert.equal(args[args.indexOf("--max-budget-usd") + 1], "3");
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    assert.equal(new Set(calls.map((c) => c.runId)).size, 1);
    assert.ok(calls[0].runId);
    assert.equal(calls[0].plan, "demo");

    assert.match(calls[2].system, /"Resume" section/);
    assert.match(calls[4].system, /carried to you: session 2 \(closed with packages carried; the whole session\)/);
    assert.match(calls[4].system, /"Carry-over" section/);
    assert.doesNotMatch(calls[5].system, /carried to you/);
    assert.match(out.stdout, /session 2 closed with packages carried; running it again in a fresh process \(run 2\/3\)/);
    assert.match(out.stdout, /session 2: carried \(whole session; closed with packages carried\); the next session resolves it first/);
    assert.match(out.stdout, /end of the queue; one more run for each unfinished session: 2/);
    assert.match(out.stdout, /still unfinished: 2/);
    assert.doesNotMatch(out.stdout + out.stderr, /STOP|blocked/);
    assert.ok(!existsSync(join(repo, PLAN, "sessions", "3.yaml")));
    assert.ok(existsSync(join(repo, PLAN, "sessions", "2.yaml")));

    const all = events();
    const started = all.find((e) => e.kind === "run_started");
    assert.equal(started.run_id, calls[0].runId);
    assert.equal(started.options.model, "sonnet");
    assert.equal(started.options.maxBudgetUsd, 3);
    assert.equal(all.filter((e) => e.kind === "session_started").length, 8);
    const closed = all.filter((e) => e.kind === "session_closed");
    assert.deepEqual(closed.map((e) => [e.session, e.status, e.cost_usd]), [
      ["1", "done", 0.5], ["2", "carried", 1.5], ["3", "done", 0.5], ["4", "done", 0.5], ["10", "done", 0.5], ["2", "carried", 2],
    ]);
    assert.ok(all.every((e) => e.run_id === started.run_id && e.plan === "demo"));
  });

  it("goes on after a session leaves the tree dirty, handing the exact files to the next session", () => {
    yamlPlan([["1", "pending"], ["2", "pending", ["1"]]]);
    const out = run([], { FAKE_DIRTY: "1" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "2"]);
    assert.doesNotMatch(calls[0].system, /no session committed/);
    assert.match(calls[1].system, /The working tree holds changes no session committed: notes\.txt\. Before your own packages, resolve them/);
    assert.match(out.stdout, /session 2 resolves the leftover changes first: notes\.txt/);
    assert.doesNotMatch(out.stdout + out.stderr, /STOP/);
  });

  it("starts on a dirty tree by handing the changes to the first session", () => {
    yamlPlan([["1", "pending"]]);
    write("notes.txt", "changed\n");
    const out = run([]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(fakeCalls()[0].system, /changes no session committed: notes\.txt/);
  });

  it("retries a session that never finishes, carries it without stopping, and sums the cost of every run", () => {
    yamlPlan([["1", "pending"]]);
    // A fake that ends successfully without touching anything.
    writeFileSync(join(tmp, "bin", "claude"), `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.25, result: "idle" }));\n`);
    const out = run(["--no-wait"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /ended pending without progress; running it again in a fresh process \(run 3\/3\)/);
    assert.match(out.stdout, /session 1: carried/);
    assert.match(out.stdout, /still unfinished: 1/);
    const closed = events().filter((e) => e.kind === "session_closed");
    assert.deepEqual(closed.map((e) => [e.session, e.status, e.cost_usd, e.commits]), [["1", "carried", 0.75, 0], ["1", "carried", 1, 0]]);
  });

  it("retries a failed session and carries it when it keeps failing", () => {
    yamlPlan([["1", "pending"], ["2", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), `#!/usr/bin/env node
const fs = require("node:fs");
const m = /session (\\S+)$/.exec(process.argv[3] ?? "");
if (m) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ session: m[1] }) + "\\n");
if (m && m[1] === "2") { fs.rmSync("${PLAN}/sessions/2.yaml"); require("node:child_process").execFileSync("git", ["commit", "-qam", "s2"]); }
console.log(JSON.stringify({ type: "result", is_error: !m || m[1] === "1", result: "x" }));
process.exit(m && m[1] === "1" ? 1 : 0);
`);
    const out = run(["--no-wait"]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.deepEqual(fakeCalls().map((c) => c.session), ["1", "1", "1", "2", "1"]);
    assert.match(out.stdout, /session 1 failed \(exit 1, no result\); running it again/);
    assert.match(out.stdout, /session 2: done/);
  });
});

// A fake whose first run of each session crosses the context warning: it records the stop where the hook would, commits a
// partial change when FAKE_PROGRESS is set (only writes it with FAKE_PROGRESS=files), and leaves the session pending; later runs finish the session.
const STOPPING_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const match = /^\\/orchestrate (\\S+)\\/plan\\.yaml session (\\S+)$/.exec(process.argv[3] ?? "");
if (!match) { console.log(JSON.stringify({ type: "result", is_error: false, result: "OK" })); process.exit(0); }
const [, dir, id] = match;
const count = process.env.FAKE_LOG + "." + id;
const runs = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) + 1 : 1;
fs.writeFileSync(count, String(runs));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ session: id, warnFile: process.env.LABSHELF_BUDGET_WARN_FILE, system: process.argv[process.argv.indexOf("--append-system-prompt") + 1] }) + "\\n");
if (runs === 1) {
  fs.writeFileSync(process.env.LABSHELF_BUDGET_WARN_FILE, "{}");
  if (process.env.FAKE_PROGRESS) {
    fs.writeFileSync("partial-" + id + ".txt", "x");
    if (process.env.FAKE_PROGRESS !== "files") {
      execFileSync("git", ["add", "-A"]);
      execFileSync("git", ["commit", "-q", "-m", "partial " + id]);
    }
  }
} else {
  fs.rmSync(dir + "/sessions/" + id + ".yaml");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "session " + id]);
}
console.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.5, result: "stopped" }));
`;

describe("runPlan after a context warning", () => {
  it("runs the session again in a fresh process when the warned run made progress", () => {
    yamlPlan([["1", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), STOPPING_CLAUDE);
    const out = run([], { FAKE_PROGRESS: "1" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "1"]);
    assert.ok(calls[0].warnFile && calls[0].warnFile !== calls[1].warnFile);
    assert.doesNotMatch(calls[0].system, /Resume/);
    assert.match(calls[1].system, /"Resume" section/);
    assert.match(calls[1].system, /plan\.mjs finished 1 --check`: on "finished on this tree" run `plan close 1`/);
    assert.match(out.stdout, /session 1 crossed the context warning and ended pending after progress; running it again in a fresh process \(1\/5\)/);
    assert.deepEqual(events().filter((e) => e.kind === "session_closed").map((e) => [e.session, e.status, e.cost_usd]), [["1", "done", 1]]);
  });

  it("counts files written without a commit as progress", () => {
    yamlPlan([["1", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), STOPPING_CLAUDE);
    const out = run([], { FAKE_PROGRESS: "files" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.deepEqual(fakeCalls().map((c) => c.session), ["1", "1"]);
    assert.match(out.stdout, /ended pending after progress; running it again in a fresh process \(1\/5\)/);
  });

  it("counts a warned run without progress as a run and runs the session again", () => {
    yamlPlan([["1", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), STOPPING_CLAUDE);
    const out = run([]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /ended pending without progress; running it again in a fresh process \(run 2\/3\)/);
    assert.deepEqual(fakeCalls().map((c) => c.session), ["1", "1"]);
  });
});

describe("runPlan on an .md plan", () => {
  it("keeps today's prompt and success rule", () => {
    mdPlan(["2", "1"]);
    const out = run([]);
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "2"]);
    assert.equal(calls[0].prompt, `/orchestrate ${PLAN}/plan.md session 1`);
    assert.deepEqual(events().filter((e) => e.kind === "session_closed").map((e) => [e.session, e.status]), [["1", "done"], ["2", "done"]]);
  });
});
