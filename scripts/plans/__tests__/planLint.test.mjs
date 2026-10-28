import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPlan, loadSession, savePlan, saveSession } from "../planFiles.mjs";
import { planLint } from "../planLint.mjs";
import { planNew } from "../planNew.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const HIDDEN = "documents/plans/demo/tests/1.1/a.test.mjs";

const spec = (id, over = {}) => ({
  id,
  goal: "g",
  level: "behaviour",
  runner: { agent: "implementer", model: "sonnet" },
  edit: [{ path: "scripts/x/a.mjs", lines: "1-5", why: "w" }],
  acceptance: [{ id: "A1", check: "c" }],
  tests: { hidden: [HIDDEN], command: "node scripts/agents/run.mjs test tooling -- a" },
  ...over,
});

/** A temp repo with a valid plan "demo": one session owning scripts/x/ with the given packages. */
function fixture({ packages = [spec("1.1")], owns = ["scripts/x/"], testText = 'it("A1 works", () => {});\n', acceptance = [{ id: "A1", check: "c" }] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "plan-lint-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const dir = planNew(root, { slug: "demo", level: "N2" });
  savePlan(dir, { ...loadPlan(dir), acceptance });
  saveSession(dir, { ...loadSession(dir, "1"), owns, packages });
  mkdirSync(dirname(join(root, HIDDEN)), { recursive: true });
  writeFileSync(join(root, HIDDEN), testText);
  return { root, dir };
}
const lint = ({ root, dir }) => planLint(root, dir);

describe("planLint valid", () => {
  it("a valid fixture has no problems and the CLI prints nothing", () => {
    const f = fixture();
    assert.deepEqual(lint(f), []);
    const result = spawnSync("node", [cli, "lint", f.dir], { cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });

  it("parallel specs with disjoint paths pass", () => {
    const f = fixture({ packages: [spec("1.1"), spec("1.2", { edit: [{ path: "scripts/x/b.mjs", lines: "1-5", why: "w" }] })] });
    assert.deepEqual(lint(f), []);
  });

  it("specs ordered by depends_on may share paths, directly or transitively", () => {
    const f = fixture({ packages: [spec("1.1"), spec("1.2", { depends_on: ["1.1"] }), spec("1.3", { depends_on: ["1.2"] })] });
    assert.deepEqual(lint(f), []);
  });
});

describe("planLint problems", () => {
  it("fails on overlapping edit in parallel packages", () => {
    const f = fixture({ packages: [spec("1.1"), spec("1.2")] });
    const problems = lint(f);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /1\.1 and 1\.2/);
  });

  it("folder entries cover their contents", () => {
    const f = fixture({ packages: [spec("1.1", { create: ["scripts/x/"] }), spec("1.2", { edit: [{ path: "scripts/x/b.mjs", lines: "1-5", why: "w" }] })] });
    assert.ok(lint(f).some((p) => /1\.1 and 1\.2/.test(p)));
  });

  it("fails on a path outside the session owns", () => {
    const f = fixture({ packages: [spec("1.1", { create: ["scripts/y/new.mjs"] })] });
    assert.ok(lint(f).some((p) => p.includes("scripts/y/new.mjs") && /owns/.test(p)));
  });

  it("fails on an acceptance id with no test name", () => {
    const f = fixture({ testText: 'it("A2 other", () => {});\nit("works for A1", () => {});\n' });
    assert.ok(lint(f).some((p) => /A1/.test(p) && /test name/.test(p)));
  });

  it("accepts test( and single quotes for the test name", () => {
    assert.deepEqual(lint(fixture({ testText: "test('A1 works', () => {});\n" })), []);
  });

  it("does not take A10 for A1", () => {
    assert.ok(lint(fixture({ testText: 'it("A10 works", () => {});\n' })).length > 0);
  });

  it("fails on a missing hidden test file", () => {
    const f = fixture({ packages: [spec("1.1", { tests: { hidden: ["nope/missing.test.mjs"], command: "c" } })] });
    assert.ok(lint(f).some((p) => p.includes("nope/missing.test.mjs")));
  });

  it("skips the test checks when tests is {none}", () => {
    assert.deepEqual(lint(fixture({ packages: [spec("1.1", { tests: { none: "css only" } })] })), []);
  });

  it("fails on a plan acceptance id no spec carries", () => {
    const f = fixture({ acceptance: [{ id: "A1", check: "c" }, { id: "A9", check: "c" }] });
    assert.ok(lint(f).some((p) => p.includes("A9")));
  });

  it("fails on duplicate spec ids", () => {
    const f = fixture({ packages: [spec("1.1"), spec("1.1", { edit: [{ path: "scripts/x/b.mjs", lines: "1-5", why: "w" }] })] });
    assert.ok(lint(f).some((p) => /duplicate spec id 1\.1/.test(p)));
  });

  it("fails on a spec depends_on that does not exist or cycles", () => {
    const missing = fixture({ packages: [spec("1.1", { depends_on: ["9.9"] })] });
    assert.ok(lint(missing).some((p) => p.includes("9.9")));
    const cycle = fixture({ packages: [spec("1.1", { depends_on: ["1.2"] }), spec("1.2", { depends_on: ["1.1"] })] });
    assert.ok(lint(cycle).some((p) => /cycle/.test(p)));
  });

  it("fails on duplicate session ids", () => {
    const f = fixture();
    const plan = loadPlan(f.dir);
    savePlan(f.dir, { ...plan, sessions: [plan.sessions[0], plan.sessions[0]] });
    assert.ok(lint(f).some((p) => /duplicate session id 1/.test(p)));
  });

  it("fails on a session depends_on that does not exist or cycles", () => {
    const missing = fixture();
    const plan = loadPlan(missing.dir);
    savePlan(missing.dir, { ...plan, sessions: [{ ...plan.sessions[0], depends_on: ["7"] }] });
    assert.ok(lint(missing).some((p) => p.includes("7") && /does not exist/.test(p)));
    const cycle = fixture();
    savePlan(cycle.dir, { ...plan, sessions: [{ ...plan.sessions[0], depends_on: ["2"] }, { id: "2", file: "sessions/2.yaml", depends_on: ["1"], owns: [] }] });
    assert.ok(lint(cycle).some((p) => /session depends_on cycle/.test(p)));
  });

  it("reports schema errors of the plan and of a session, one line each", () => {
    const f = fixture();
    writeFileSync(join(f.dir, "sessions", "1.yaml"), "schema: session/v1\nid: '1'\n");
    const problems = lint(f);
    const sessionLines = problems.filter((p) => p.startsWith("sessions/1.yaml: "));
    assert.ok(sessionLines.length >= 3);
    assert.ok(problems.every((p) => !p.includes("\n")));
  });

  it("the CLI prints one line per problem and exits 1", () => {
    const f = fixture({ packages: [spec("1.1"), spec("1.2")] });
    const result = spawnSync("node", [cli, "lint", f.dir], { cwd: f.root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.equal(result.stdout.trim().split("\n").length, 1);
  });
});
