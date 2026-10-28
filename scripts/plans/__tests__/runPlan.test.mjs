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
// blocked when its id is in FAKE_BLOCK), commits, and records its arguments and environment in FAKE_LOG.
const FAKE_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const args = process.argv.slice(2);
const prompt = args[1];
const match = /^\\/orchestrate (\\S+)\\/plan\\.(md|yaml) session (\\S+)$/.exec(prompt ?? "");
if (!match) { console.log(JSON.stringify({ type: "result", is_error: false, result: "OK" })); process.exit(0); }
const [, dir, format, id] = match;
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ args, prompt, runId: process.env.LABSHELF_PLAN_RUN_ID, plan: process.env.LABSHELF_PLAN, session: process.env.LABSHELF_PLAN_SESSION }) + "\\n");
console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "sid-" + id, model: "fake-model" }));
const file = dir + "/sessions/" + id + "." + format;
if ((process.env.FAKE_BLOCK ?? "").split(",").includes(id)) {
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/^status: pending$/m, "status: blocked\\nblocked_reason: needs a decision"));
} else fs.rmSync(file);
execFileSync("git", ["add", "-A"]);
execFileSync("git", ["commit", "-q", "-m", "session " + id]);
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
  commitAll();
};

const mdPlan = (names, status = "approved") => {
  write(`${PLAN}/plan.md`, `# Plan\n\nStatus: ${status}\n`);
  for (const name of names) write(`${PLAN}/sessions/${name}.md`, "# session\n");
  commitAll();
};

const run = (args, env = {}) =>
  spawnSync("node", [runner, PLAN, ...args], {
    encoding: "utf8",
    env: { ...process.env, LABSHELF_PLAN_ROOT: repo, LABSHELF_TELEMETRY_SPOOL: spool, PATH: `${join(tmp, "bin")}:${process.env.PATH}`, FAKE_LOG: join(tmp, "fake.log"), ...env },
  });

const fakeCalls = () => (existsSync(join(tmp, "fake.log")) ? readFileSync(join(tmp, "fake.log"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const events = () => (existsSync(spool) ? readdirSync(spool).flatMap((f) => readFileSync(join(spool, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))) : []);
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();

describe("runPlan --dry-run", () => {
  it("prints a YAML plan in depends_on order with the skipped sessions, and spawns nothing", () => {
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
    assert.match(out.stdout, /demo: 2 sessions pending: 10, 2\n/);
    assert.match(out.stdout, /skipped 4: depends on blocked session 3/);
    assert.match(out.stdout, /skipped 5: depends on blocked session 3/);
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
  it("runs the sessions in order, goes on past a blocked one, and reports to telemetry", () => {
    yamlPlan([
      ["1", "pending"],
      ["2", "pending", ["1"]],
      ["3", "pending", ["2"]],
      ["4", "pending"],
      ["10", "pending", ["4"]],
    ]);
    const out = run(["--max-budget-usd", "3", "--model", "sonnet"], { FAKE_BLOCK: "2" });
    assert.equal(out.status, 0, out.stdout + out.stderr);

    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "2", "4", "10"]);
    assert.equal(calls[0].prompt, `/orchestrate ${PLAN}/plan.yaml session 1`);
    const args = calls[0].args;
    assert.equal(args[args.indexOf("--permission-prompts") + 1], "none");
    assert.equal(args[args.indexOf("--permission-mode") + 1], "auto");
    assert.equal(args[args.indexOf("--max-budget-usd") + 1], "3");
    assert.equal(args[args.indexOf("--model") + 1], "sonnet");
    assert.equal(new Set(calls.map((c) => c.runId)).size, 1);
    assert.ok(calls[0].runId);
    assert.equal(calls[0].plan, "demo");

    assert.match(out.stdout, /session 2 is blocked: needs a decision/);
    assert.match(out.stdout, /not run 3: depends on blocked session 2/);
    assert.ok(existsSync(join(repo, PLAN, "sessions", "3.yaml")));
    assert.ok(!existsSync(join(repo, PLAN, "sessions", "1.yaml")));

    const all = events();
    const started = all.find((e) => e.kind === "run_started");
    assert.equal(started.run_id, calls[0].runId);
    assert.equal(started.options.model, "sonnet");
    assert.equal(started.options.maxBudgetUsd, 3);
    const sessionStarted = all.filter((e) => e.kind === "session_started");
    assert.deepEqual(sessionStarted.map((e) => [e.session, e.session_id, e.model]), [
      ["1", "sid-1", "fake-model"], ["2", "sid-2", "fake-model"], ["4", "sid-4", "fake-model"], ["10", "sid-10", "fake-model"],
    ]);
    const closed = all.filter((e) => e.kind === "session_closed");
    assert.deepEqual(closed.map((e) => [e.session, e.status, e.cost_usd, e.commits]), [
      ["1", "done", 0.5, 1], ["2", "blocked", 0.5, 1], ["4", "done", 0.5, 1], ["10", "done", 0.5, 1],
    ]);
    assert.ok(all.every((e) => e.run_id === started.run_id && e.plan === "demo"));
  });

  it("stops with a failed session_closed, summing the cost of every run, when the session never commits", () => {
    yamlPlan([["1", "pending"]]);
    // A fake that ends successfully without touching anything.
    writeFileSync(join(tmp, "bin", "claude"), `#!/usr/bin/env node\nconsole.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.25, result: "idle" }));\n`);
    const out = run(["--no-wait"]);
    assert.equal(out.status, 1);
    assert.match(out.stdout, /continuing it \(3\/3\)/);
    assert.match(out.stderr, /session 1 made no commit/);
    const closed = events().filter((e) => e.kind === "session_closed");
    assert.deepEqual(closed.map((e) => [e.session, e.status, e.cost_usd, e.commits]), [["1", "failed", 1, 0]]);
  });
});

// A fake whose first run of each session hits the context stop: it records the stop where the hook would, commits a
// partial change when FAKE_PROGRESS is set, and leaves the session pending; later runs finish the session.
const STOPPING_CLAUDE = `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const match = /^\\/orchestrate (\\S+)\\/plan\\.yaml session (\\S+)$/.exec(process.argv[3] ?? "");
if (!match) { console.log(JSON.stringify({ type: "result", is_error: false, result: "OK" })); process.exit(0); }
const [, dir, id] = match;
const count = process.env.FAKE_LOG + "." + id;
const runs = fs.existsSync(count) ? Number(fs.readFileSync(count, "utf8")) + 1 : 1;
fs.writeFileSync(count, String(runs));
fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ session: id, stopFile: process.env.LABSHELF_BUDGET_STOP_FILE }) + "\\n");
if (runs === 1) {
  fs.writeFileSync(process.env.LABSHELF_BUDGET_STOP_FILE, "{}");
  if (process.env.FAKE_PROGRESS) {
    fs.writeFileSync("partial-" + id + ".txt", "x");
    execFileSync("git", ["add", "-A"]);
    execFileSync("git", ["commit", "-q", "-m", "partial " + id]);
  }
} else {
  fs.rmSync(dir + "/sessions/" + id + ".yaml");
  execFileSync("git", ["add", "-A"]);
  execFileSync("git", ["commit", "-q", "-m", "session " + id]);
}
console.log(JSON.stringify({ type: "result", is_error: false, total_cost_usd: 0.5, result: "stopped" }));
`;

describe("runPlan after a context stop", () => {
  it("runs the session again in a fresh process when the stopped run made progress", () => {
    yamlPlan([["1", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), STOPPING_CLAUDE);
    const out = run([], { FAKE_PROGRESS: "1" });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    const calls = fakeCalls();
    assert.deepEqual(calls.map((c) => c.session), ["1", "1"]);
    assert.ok(calls[0].stopFile && calls[0].stopFile !== calls[1].stopFile);
    assert.match(out.stdout, /session 1 stopped at the context limit after progress; running it again in a fresh process \(1\/5\)/);
    assert.deepEqual(events().filter((e) => e.kind === "session_closed").map((e) => [e.session, e.status, e.cost_usd]), [["1", "done", 1]]);
  });

  it("stops the runner when the stopped run made no progress", () => {
    yamlPlan([["1", "pending"]]);
    writeFileSync(join(tmp, "bin", "claude"), STOPPING_CLAUDE);
    const out = run([]);
    assert.equal(out.status, 1);
    assert.match(out.stderr, /session 1 hit the context limit without progress/);
    assert.equal(fakeCalls().length, 1);
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
