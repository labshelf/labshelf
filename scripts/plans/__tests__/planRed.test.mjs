import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { parseJest } from "../../agents/run.mjs";
import { planRed, prepareRed, redProblems, redRecordPath, restoreRed } from "../planRed.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const HIDDEN = "documents/plans/demo/tests/1.1/scripts/x/__tests__/lib.test.mjs";
const COMMAND = "node scripts/agents/run.mjs test tooling --spec 1.1 --plan demo -- scripts/x/__tests__/lib.test.mjs";

const git = (root, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const porcelain = (root) => git(root, "status", "--porcelain", "--untracked-files=all");

const GOOD_TEST = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { add } from "../lib.mjs";
describe("add", () => {
  it("A1 adds", () => assert.equal(add(1, 2), 3));
  it("A2 adds zero", () => assert.equal(add(0, 0), 0));
});
`;

// `existing` is the content of the seam file before red (null: the file does not exist yet).
const setup = ({ hidden = GOOD_TEST, existing = null } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "plan-red-"));
  git(root, "init", "-q");
  const dir = planNew(root, { slug: "demo", level: "N2" });
  saveSession(dir, {
    ...loadSession(dir, "1"),
    packages: [
      {
        id: "1.1",
        plan: "demo",
        goal: "g",
        level: "behaviour",
        runner: { agent: "implementer", model: "sonnet" },
        edit: [],
        seams: [{ path: "scripts/x/lib.mjs", signature: "export function add(a, b)" }],
        acceptance: [{ id: "A1", check: "c" }],
        tests: { hidden: [HIDDEN], command: COMMAND },
      },
    ],
  });
  write(root, HIDDEN, hidden);
  if (existing !== null) write(root, "scripts/x/lib.mjs", existing);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "base");
  return { root, dir };
};
const args = (dir) => ({ planDir: dir, sessionId: "1", specId: "1.1" });

describe("planRed", () => {
  it("accepts tests that all fail with not implemented and leaves the tree as it was", async () => {
    const { root, dir } = setup();
    const before = porcelain(root);
    const result = await planRed(root, args(dir));
    assert.deepEqual(result.problems, []);
    assert.equal(result.ok, true);
    assert.equal(result.total, 2);
    assert.equal(porcelain(root), before);
    assert.equal(existsSync(join(root, "scripts/x")), false);
    assert.equal(existsSync(redRecordPath(root)), false);
  });

  it("restores an existing seam file with uncommitted edits byte for byte", async () => {
    const { root, dir } = setup({ existing: "export function other() {}\n" });
    write(root, "scripts/x/lib.mjs", "export function other() { return 1; }\n// local edit\n");
    const before = porcelain(root);
    const result = await planRed(root, args(dir));
    assert.equal(result.ok, true, result.problems.join("\n"));
    assert.equal(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8"), "export function other() { return 1; }\n// local edit\n");
    assert.equal(porcelain(root), before);
  });

  it("rejects a test file with an import error and still restores", async () => {
    const { root, dir } = setup({ hidden: GOOD_TEST.replace("../lib.mjs", "../missing.mjs") });
    const before = porcelain(root);
    const result = await planRed(root, args(dir));
    assert.equal(result.ok, false);
    assert.ok(result.problems.length > 0);
    assert.equal(porcelain(root), before);
    assert.equal(existsSync(redRecordPath(root)), false);
  });

  it("rejects a test that fails for another reason or passes, naming it", async () => {
    const hidden = `import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { add } from "../lib.mjs";
describe("add", () => {
  it("A1 other failure", () => assert.equal(1, 2));
  it("A2 passes", () => assert.ok(true));
  it("A3 not implemented", () => add(1, 2));
});
`;
    const { root, dir } = setup({ hidden });
    const result = await planRed(root, args(dir));
    assert.equal(result.ok, false);
    const text = result.problems.join("\n");
    assert.match(text, /A1 other failure/);
    assert.match(text, /A2 passes/);
    assert.doesNotMatch(text, /A3 not implemented/);
  });

  it("rejects a syntax error in the test file", async () => {
    const { root, dir } = setup({ hidden: "import { add } from '../lib.mjs';\nit(\n" });
    assert.equal((await planRed(root, args(dir))).ok, false);
  });

  it("does not count the run: no state file for the spec is written", async () => {
    const { root, dir } = setup();
    const runs = mkdtempSync(join(tmpdir(), "plan-red-runs-"));
    process.env.LABSHELF_RUNS_DIR = runs;
    try {
      await planRed(root, args(dir));
    } finally {
      delete process.env.LABSHELF_RUNS_DIR;
    }
    assert.equal(existsSync(join(runs, "demo", "1.1.json")), false);
  });
});

describe("plan red --restore", () => {
  it("restores the tree after a simulated crash and deletes the record", async () => {
    const { root, dir } = setup({ existing: "export function other() {}\n" });
    const before = porcelain(root);
    prepareRed(root, loadSession(dir, "1").packages[0]);
    assert.notEqual(porcelain(root), before);
    assert.ok(existsSync(redRecordPath(root)));
    assert.throws(() => prepareRed(root, loadSession(dir, "1").packages[0]), /--restore/);
    const result = spawnSync("node", [cli, "red", "--restore"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(porcelain(root), before);
    assert.equal(readFileSync(join(root, "scripts/x/lib.mjs"), "utf8"), "export function other() {}\n");
    assert.equal(existsSync(redRecordPath(root)), false);
    assert.deepEqual(restoreRed(root), []);
  });

  it("removes created files and folders", async () => {
    const { root, dir } = setup();
    const before = porcelain(root);
    prepareRed(root, loadSession(dir, "1").packages[0]);
    assert.ok(existsSync(join(root, "scripts/x/lib.mjs")));
    restoreRed(root);
    assert.equal(existsSync(join(root, "scripts/x")), false);
    assert.equal(porcelain(root), before);
  });
});

describe("plan.mjs red", () => {
  it("exits 0 when red and 1 when rejected", () => {
    const ok = setup();
    const accepted = spawnSync("node", [cli, "red", "1", "1.1"], { cwd: ok.root, encoding: "utf8" });
    assert.equal(accepted.status, 0, accepted.stdout + accepted.stderr);
    const bad = setup({ hidden: GOOD_TEST.replace("../lib.mjs", "../missing.mjs") });
    const rejected = spawnSync("node", [cli, "red", "1", "1.1"], { cwd: bad.root, encoding: "utf8" });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stdout, /rejected/);
  });
});

describe("redProblems with jest results", () => {
  const json = (suites) => ({ testResults: suites });
  it("accepts failures that say not implemented and rejects a suite that failed to run", () => {
    const good = json([{ name: "/r/a.test.ts", status: "failed", assertionResults: [{ fullName: "a one", status: "failed", failureMessages: ["Error: not implemented: 1.1\n at x"] }] }]);
    assert.deepEqual(redProblems(parseJest(good, { root: "/r" })), []);
    const broken = json([{ name: "/r/a.test.ts", status: "failed", assertionResults: [], message: "Cannot find module '../src/a'" }]);
    assert.match(redProblems(parseJest(broken, { root: "/r" }))[0], /a\.test\.ts/);
    const passing = json([{ name: "/r/a.test.ts", status: "passed", assertionResults: [{ fullName: "a one", status: "passed", failureMessages: [] }] }]);
    assert.match(redProblems(parseJest(passing, { root: "/r" }))[0], /passes: a\.test\.ts > a one/);
    assert.equal(redProblems([]).length, 1);
  });
});
