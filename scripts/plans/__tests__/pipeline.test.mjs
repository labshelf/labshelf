// End to end, without a model: the YAML flow of research/new-flow.md on a temp git repo, driven through the real plan CLI.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { main as runMain } from "../../agents/run.mjs";
import { parseBlocks, validate } from "../../agents/schemas.mjs";
import { loadPlan, loadSession, savePlan, saveSession } from "../planFiles.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const runner = fileURLToPath(new URL("../runPlan.mjs", import.meta.url));

const HIDDEN = "documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs";
const COMMAND = "node scripts/agents/run.mjs test tooling --spec 1.1 --plan demo -- scripts/x/__tests__/lib.test.mjs";
const HIDDEN_SOURCE = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { add } from "../lib.mjs";
describe("add", () => {
  it("A1 adds two numbers", () => assert.equal(add(1, 2), 3));
});
`;
const SPEC = {
  id: "1.1",
  plan: "demo",
  goal: "Add the add function",
  level: "behaviour",
  runner: { agent: "implementer", model: "sonnet" },
  edit: [],
  create: ["scripts/x/lib.mjs"],
  seams: [{ path: "scripts/x/lib.mjs", signature: "export function add(a, b)" }],
  acceptance: [{ id: "A1", check: "add(1, 2) is 3" }],
  tests: { hidden: [HIDDEN], command: COMMAND },
};

const saved = {};
let scratch;
let counter = 0;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "pipeline-"));
  const env = {
    LABSHELF_CLOSE_GATE: "true",
    LABSHELF_TELEMETRY_SPOOL: join(scratch, "spool"),
    LABSHELF_LOGS_DIR: join(scratch, "logs"),
    LABSHELF_RED_FILE: join(scratch, "red.json"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  for (const key of [...Object.keys(env), "LABSHELF_RUNS_DIR", "LABSHELF_PLAN"]) saved[key] = process.env[key];
  Object.assign(process.env, env);
  delete process.env.LABSHELF_PLAN;
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const git = (root, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const commitAll = (root, message) => {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
};
const newRepo = () => {
  process.env.LABSHELF_RUNS_DIR = join(scratch, `runs-${(counter += 1)}`);
  const root = mkdtempSync(join(scratch, "repo-"));
  git(root, "init", "-q");
  write(root, "README.md", "demo\n");
  commitAll(root, "init");
  return root;
};
const plan = (root, ...args) => spawnSync("node", [cli, ...args], { cwd: root, encoding: "utf8", env: process.env });
const ok = (result) => {
  assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  return result.stdout;
};

describe("the YAML flow from plan new to plan close", () => {
  it("takes one spec from plan new through red, start, a green run and a report to a single package commit", async () => {
    const root = newRepo();
    const dir = join(root, "documents", "plans", "demo");

    // plan new, then the planning step writes the spec and its hidden test.
    assert.match(ok(plan(root, "new", "demo", "--level", "N2")), /created .*documents\/plans\/demo/);
    savePlan(dir, { ...loadPlan(dir), status: "approved", goal: "Prove the flow", acceptance: [{ id: "A1", check: "add(1, 2) is 3" }] });
    saveSession(dir, { ...loadSession(dir, "1"), goal: "Add add", owns: ["scripts/x/"], packages: [SPEC] });
    write(root, HIDDEN, HIDDEN_SOURCE);
    commitAll(root, "plan demo");

    // lint is silent.
    const lint = plan(root, "lint", "documents/plans/demo");
    assert.equal(lint.status, 0, lint.stdout + lint.stderr);
    assert.equal(lint.stdout, "");

    // red passes and leaves the tree untouched.
    const clean = git(root, "status", "--porcelain", "--untracked-files=all");
    assert.match(ok(plan(root, "red", "1", "1.1", "--plan", "demo")), /red: 1 tests, all fail with "not implemented"/);
    assert.equal(git(root, "status", "--porcelain", "--untracked-files=all"), clean);
    assert.equal(existsSync(join(root, "scripts/x")), false);

    // spec -> implementer prompt.
    const prompt = ok(plan(root, "prompt", "1", "1.1", "--plan", "demo"));
    assert.ok(prompt.includes("```yaml spec/v1\nschema: spec/v1\n"));
    const { spec: block } = parseBlocks(prompt);
    assert.deepEqual(validate("spec", block), []);
    assert.equal(block.id, "1.1");
    assert.equal(block.goal, SPEC.goal);
    assert.deepEqual(block.tests, SPEC.tests);
    assert.equal(prompt.trimEnd().split("\n").at(-1), "Return report/v1.");

    // start copies the hidden test in place and stubs the seam; the stub still fails.
    const started = ok(plan(root, "start", "1", "1.1", "--plan", "demo"));
    assert.match(started, /test scripts\/x\/__tests__\/lib\.test\.mjs/);
    assert.match(started, /created scripts\/x\/lib\.mjs/);
    assert.match(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8"), /not implemented: 1\.1/);

    // A scripted edit stands in for the implementer; the spec's own test command goes green.
    write(root, "scripts/x/lib.mjs", "export function add(a, b) {\n  return a + b;\n}\n");
    const lines = [];
    const spawn = (command, args, options) => {
      const env = { ...options.env };
      delete env.NODE_TEST_CONTEXT;
      return spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 30, ...options, env });
    };
    const code = await runMain(COMMAND.split(" ").slice(2), { root, spawn, out: (line) => lines.push(line) });
    assert.equal(code, 0, lines.join("\n"));
    assert.match(lines[0], /^\[test tooling\] exit 0/);

    // The implementer's report; finish is skipped at this level.
    const report = {
      schema: "report/v1",
      spec: "1.1",
      status: "done",
      changes: [{ path: "scripts/x/lib.mjs", what: "add implemented" }],
      acceptance: [{ id: "A1", result: "pass" }],
    };
    assert.deepEqual(validate("report", report), []);
    write(process.env.LABSHELF_RUNS_DIR, "demo/1.1.report.yaml", stringify(report));

    // close: one package commit with the spec message, then the bookkeeping commit; the session file is gone.
    const before = git(root, "rev-parse", "HEAD");
    assert.match(ok(plan(root, "close", "1", "--plan", "demo")), /session 1 done: 2 commit\(s\)/);
    assert.equal(git(root, "rev-list", "--count", `${before}..HEAD`), "2");
    const [bookkeeping, pkg] = git(root, "log", "-2", "--format=%H").split("\n");
    assert.equal(git(root, "log", "-1", "--format=%s", pkg), SPEC.goal);
    assert.match(git(root, "log", "-1", "--format=%b", pkg), /Package 1\.1 of plan demo/);
    assert.deepEqual(git(root, "show", "--name-only", "--format=", pkg).split("\n").sort(), ["scripts/x/__tests__/lib.test.mjs", "scripts/x/lib.mjs"]);
    assert.equal(git(root, "log", "-1", "--format=%s", bookkeeping), "Session 1 close");
    assert.equal(existsSync(join(dir, "sessions", "1.yaml")), false);
    assert.match(readFileSync(join(dir, "log.md"), "utf8"), /session 1 done: 1\.1/);
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8"), "export function add(a, b) {\n  return a + b;\n}\n");
    assert.equal(parse(readFileSync(join(process.env.LABSHELF_RUNS_DIR, "demo/1.1.report.yaml"), "utf8")).status, "done");
  });

  it("parks the work and blocks the session when the report is not done", () => {
    const root = newRepo();
    const dir = join(root, "documents", "plans", "demo");
    ok(plan(root, "new", "demo", "--level", "N2"));
    saveSession(dir, { ...loadSession(dir, "1"), owns: ["scripts/x/"], packages: [SPEC] });
    commitAll(root, "plan demo");
    write(root, "scripts/x/lib.mjs", "half done\n");
    write(process.env.LABSHELF_RUNS_DIR, "demo/1.1.report.yaml", stringify({ schema: "report/v1", spec: "1.1", status: "blocked_tests", changes: [], acceptance: [] }));

    assert.match(ok(plan(root, "close", "1", "--plan", "demo")), /session 1 blocked/);
    assert.equal(existsSync(join(root, "scripts/x/lib.mjs")), false);
    assert.match(readFileSync(join(process.env.LABSHELF_RUNS_DIR, "demo/1.1.patch"), "utf8"), /half done/);
    assert.equal(loadSession(dir, "1").status, "blocked");
  });
});

describe("runPlan --dry-run on a YAML plan", () => {
  it("prints the queue in depends_on order and changes nothing", () => {
    const root = newRepo();
    const dir = join(root, "documents", "plans", "demo");
    ok(plan(root, "new", "demo", "--level", "N3"));
    const base = loadSession(dir, "1");
    const entry = (id, depends_on) => ({ id, file: `sessions/${id}.yaml`, depends_on, owns: [] });
    savePlan(dir, { ...loadPlan(dir), status: "approved", sessions: [entry("1", ["2"]), entry("2", [])] });
    saveSession(dir, { ...base, depends_on: ["2"] });
    saveSession(dir, { ...base, id: "2", depends_on: [] });
    commitAll(root, "plan demo");
    const head = git(root, "rev-parse", "HEAD");

    const out = spawnSync("node", [runner, "documents/plans/demo", "--dry-run"], { encoding: "utf8", env: { ...process.env, LABSHELF_PLAN_ROOT: root } });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /demo: 2 sessions pending: 2, 1\n/);
    assert.doesNotMatch(out.stdout, /skipped/);
    assert.equal(git(root, "rev-parse", "HEAD"), head);
    assert.equal(git(root, "status", "--porcelain"), "");
  });
});
