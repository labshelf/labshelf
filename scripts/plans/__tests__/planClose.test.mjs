import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSession, saveSession } from "../planFiles.mjs";
import { treeState, writeGateRecord } from "../../lint/gateRecord.mjs";
import { planClose } from "../planClose.mjs";
import { checkFinished, markFinished } from "../planFinished.mjs";
import { planNew } from "../planNew.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));

const git = (root, ...args) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const filesOf = (root, rev) => git(root, "show", "--name-only", "--format=", rev).split("\n").filter(Boolean).sort();

const spec = (id, extra) => ({
  id,
  plan: "demo",
  goal: `Goal of ${id}`,
  level: "behaviour",
  runner: { agent: "implementer", model: "sonnet" },
  sha: "abc",
  edit: [],
  acceptance: [],
  tests: { hidden: [], command: "" },
  ...extra,
});

const report = (id, status) => `schema: report/v1\nspec: "${id}"\nstatus: ${status}\nchanges: []\nacceptance: []\n`;

const saved = {};
let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "plan-close-env-"));
  for (const key of ["LABSHELF_CLOSE_GATE", "LABSHELF_RUNS_DIR", "LABSHELF_TELEMETRY_SPOOL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) saved[key] = process.env[key];
  Object.assign(process.env, {
    LABSHELF_TELEMETRY_SPOOL: join(scratch, "spool"),
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  });
});
afterEach(() => {
  process.env.LABSHELF_CLOSE_GATE = "true";
});
after(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

// A repo with a committed plan "demo" whose session 1 owns src/ and has two packages.
const setup = ({ milestone = false } = {}) => {
  process.env.LABSHELF_CLOSE_GATE = "true";
  process.env.LABSHELF_RUNS_DIR = mkdtempSync(join(scratch, "runs-"));
  const root = mkdtempSync(join(tmpdir(), "plan-close-"));
  git(root, "init", "-q");
  const dir = planNew(root, { slug: "demo", level: "N2" });
  write(root, "src/a.mjs", "a1\n");
  write(root, "src/b.mjs", "b1\n");
  write(root, "src/c.mjs", "c1\n");
  saveSession(dir, {
    ...loadSession(dir, "1"),
    owns: ["src/"],
    milestone,
    packages: [
      spec("1.1", {
        edit: [{ path: "src/a.mjs", lines: "1-1", why: "w" }],
        create: ["src/new1.mjs"],
        tests: { hidden: ["documents/plans/demo/tests/1.1/src/a.test.mjs"], command: "x" },
      }),
      spec("1.2", { edit: [{ path: "src/b.mjs", lines: "1-1", why: "w" }], create: ["src/new2/"] }),
    ],
  });
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, dir, runs: join(process.env.LABSHELF_RUNS_DIR, "demo") };
};

const putReport = (runs, id, status) => {
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, `${id}.report.yaml`), report(id, status));
};

const events = () => {
  const dir = process.env.LABSHELF_TELEMETRY_SPOOL;
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => readFileSync(join(dir, f), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)));
};

describe("planClose", () => {
  it("commits each done spec with exactly its paths, then the review fixes, and finishes the session", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    write(root, "src/new1.mjs", "n1\n");
    write(root, "src/a.test.mjs", "t\n");
    write(root, "src/b.mjs", "b2\n");
    write(root, "src/new2/x.mjs", "n2\n");
    write(root, "src/c.mjs", "c2\n");
    const before = git(root, "rev-parse", "HEAD");

    const result = planClose(root, { planDir: dir, sessionId: "1" });

    assert.equal(result.status, "done");
    assert.equal(git(root, "rev-list", "--count", `${before}..HEAD`), "3");
    const [review, second, first] = git(root, "log", "-3", "--format=%H").split("\n");
    assert.deepEqual(filesOf(root, first), ["src/a.mjs", "src/a.test.mjs", "src/new1.mjs"]);
    assert.deepEqual(filesOf(root, second), ["src/b.mjs", "src/new2/x.mjs"]);
    assert.equal(git(root, "log", "-1", "--format=%s", first), "Goal of 1.1");
    const body = git(root, "log", "-1", "--format=%b", first);
    assert.match(body, /Package 1\.1 of plan demo/);
    assert.match(body, /Co-Authored-By: Claude Opus 5\.5 <noreply@anthropic\.com>/);
    assert.equal(git(root, "log", "-1", "--format=%s", review), "Session 1 review fixes");
    assert.match(git(root, "log", "-1", "--format=%b", review), /Co-Authored-By: Claude Opus 5\.5/);
    assert.ok(filesOf(root, review).includes("src/c.mjs"));
    assert.deepEqual(result.commits, [first, second, review]);
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(existsSync(join(dir, "sessions", "1.yaml")), false);
    assert.match(readFileSync(join(dir, "log.md"), "utf8"), /session 1 done/);
    const kinds = events().map((e) => e.kind);
    assert.equal(kinds.filter((k) => k === "commit").length, 3);
    const closed = events().find((e) => e.kind === "session_closed");
    assert.equal(closed.status, "done");
    assert.equal(closed.commits, 3);
  });

  it("fails with no commit when a changed file is outside the session owns", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    write(root, "elsewhere/z.mjs", "z\n");
    const before = git(root, "rev-parse", "HEAD");
    assert.throws(() => planClose(root, { planDir: dir, sessionId: "1" }), /elsewhere\/z\.mjs/);
    assert.equal(git(root, "rev-parse", "HEAD"), before);
    assert.match(git(root, "status", "--porcelain"), /src\/a\.mjs/);
    assert.equal(loadSession(dir, "1").status, "pending");
  });

  it("fails with no commit when the gate fails", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    process.env.LABSHELF_CLOSE_GATE = "false";
    const before = git(root, "rev-parse", "HEAD");
    assert.throws(() => planClose(root, { planDir: dir, sessionId: "1" }), /gate/);
    assert.equal(git(root, "rev-parse", "HEAD"), before);
  });

  it("saves a patch, restores the paths and blocks the session when a spec did not finish", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "missing");
    write(root, "src/a.mjs", "a2\n");
    write(root, "src/b.mjs", "b2\n");
    write(root, "src/new2/x.mjs", "n2\n");

    const result = planClose(root, { planDir: dir, sessionId: "1" });

    assert.equal(result.status, "blocked");
    assert.equal(result.commits.length, 2);
    assert.deepEqual(filesOf(root, "HEAD~1"), ["src/a.mjs"]);
    assert.equal(git(root, "log", "-1", "--format=%s"), "Session 1 close");
    assert.equal(readFileSync(join(root, "src/b.mjs"), "utf8"), "b1\n");
    assert.equal(existsSync(join(root, "src/new2/x.mjs")), false);
    const patch = readFileSync(join(runs, "1.2.patch"), "utf8");
    assert.match(patch, /\+b2/);
    assert.match(patch, /src\/new2\/x\.mjs/);
    assert.match(patch, /\+n2/);
    const session = loadSession(dir, "1");
    assert.equal(session.status, "blocked");
    assert.match(session.blocked_reason, /1\.2/);
    assert.match(session.blocked_reason, /missing/);
    assert.equal(git(root, "status", "--porcelain"), "");
    assert.equal(events().find((e) => e.kind === "session_closed" && e.status === "blocked").commits, 2);
  });

  it("treats a spec with no report as unfinished", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    write(root, "src/a.mjs", "a2\n");
    write(root, "src/b.mjs", "b2\n");
    const result = planClose(root, { planDir: dir, sessionId: "1" });
    assert.equal(result.status, "blocked");
    assert.match(loadSession(dir, "1").blocked_reason, /1\.2.*no report/);
    assert.equal(readFileSync(join(root, "src/b.mjs"), "utf8"), "b1\n");
  });

  it("skips its gate when a pass at least as strong was recorded for this exact tree", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    writeGateRecord(root, { fingerprint: treeState(root).fingerprint, passed: true, lint: false, packages: [] });
    process.env.LABSHELF_CLOSE_GATE = "false";
    assert.equal(planClose(root, { planDir: dir, sessionId: "1" }).gate, "recorded");
  });

  it("runs its gate when the tree changed since the recorded pass, or the pass is weaker", () => {
    const { root, dir, runs } = setup({ milestone: true });
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    process.env.LABSHELF_CLOSE_GATE = "false";
    writeGateRecord(root, { fingerprint: treeState(root).fingerprint, passed: true, lint: false, packages: [] });
    assert.throws(() => planClose(root, { planDir: dir, sessionId: "1" }), /gate failed/);
    writeGateRecord(root, { fingerprint: treeState(root).fingerprint, passed: true, lint: true, packages: [] });
    write(root, "src/b.mjs", "b2\n");
    assert.throws(() => planClose(root, { planDir: dir, sessionId: "1" }), /gate failed/);
  });

  it("checks the finished marker against the tree, and close removes it", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    assert.deepEqual(checkFinished(root, { planDir: dir, sessionId: "1" }), { state: "none" });
    const marker = markFinished(root, { planDir: dir, sessionId: "1" });
    assert.equal(marker, join(runs, "1.finished"));
    assert.deepEqual(checkFinished(root, { planDir: dir, sessionId: "1" }), { state: "unchanged" });
    write(root, "src/b.mjs", "b2\n");
    write(root, "src/new1.mjs", "n1\n");
    assert.deepEqual(checkFinished(root, { planDir: dir, sessionId: "1" }), { state: "changed", files: ["src/b.mjs", "src/new1.mjs"] });
    const check = spawnSync("node", [cli, "finished", "1", "--check", "--plan", dir], { cwd: root, encoding: "utf8", env: process.env });
    assert.equal(check.status, 1);
    assert.match(check.stdout, /changed since the finishing pass:\n {2}src\/b\.mjs\n {2}src\/new1\.mjs/);
    planClose(root, { planDir: dir, sessionId: "1" });
    assert.equal(existsSync(marker), false);
  });

  it("runs through the plan CLI", () => {
    const { root, dir, runs } = setup();
    putReport(runs, "1.1", "done");
    putReport(runs, "1.2", "done");
    write(root, "src/a.mjs", "a2\n");
    const out = execFileSync("node", [cli, "close", "1", "--plan", dir], { cwd: root, encoding: "utf8", env: process.env });
    assert.match(out, /session 1 done/);
    assert.equal(git(root, "status", "--porcelain"), "");
  });
});
