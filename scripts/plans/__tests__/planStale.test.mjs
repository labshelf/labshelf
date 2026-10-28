import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { planStale } from "../planStale.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));

const git = (root, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
const write = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const commit = (root, message) => {
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", message);
  return git(root, "rev-parse", "HEAD");
};

// A repo with src files committed at `sha`; the demo spec was read at that sha.
const setup = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-stale-"));
  git(root, "init", "-q");
  const dir = planNew(root, { slug: "demo", level: "N2" });
  for (const file of ["src/a.mjs", "src/b.mjs", "src/c.mjs", "src/other.mjs", "src/dir/x.mjs"]) write(root, file, "v1\n");
  const sha = commit(root, "base");
  saveSession(dir, {
    ...loadSession(dir, "1"),
    packages: [
      {
        id: "1.1",
        plan: "demo",
        goal: "g",
        level: "behaviour",
        runner: { agent: "implementer", model: "sonnet" },
        sha,
        edit: [{ path: "src/a.mjs", lines: "1-2", why: "w" }],
        read: [{ path: "src/b.mjs", lines: "1-2", why: "w" }, { path: "src/dir/", lines: "1-2", why: "w" }],
        callers: [{ symbol: "s", path: "src/c.mjs", lines: "1-2" }],
        acceptance: [],
        tests: { hidden: [], command: "" },
      },
    ],
  });
  commit(root, "plan");
  return { root, dir, sha };
};

describe("planStale", () => {
  it("is silent when nothing the spec names changed after sha", () => {
    const { root, dir } = setup();
    write(root, "src/other.mjs", "v2\n");
    commit(root, "unrelated change");
    assert.deepEqual(planStale(root, { planDir: dir, sessionId: "1", specId: "1.1" }), []);
  });

  it("lists edit, read and caller paths changed after sha, and files inside a folder entry", () => {
    const { root, dir } = setup();
    write(root, "src/a.mjs", "v2\n");
    write(root, "src/c.mjs", "v2\n");
    write(root, "src/dir/x.mjs", "v2\n");
    write(root, "src/other.mjs", "v2\n");
    commit(root, "changes");
    assert.deepEqual(planStale(root, { planDir: dir, sessionId: "1", specId: "1.1" }).sort(), ["src/a.mjs", "src/c.mjs", "src/dir/x.mjs"]);
  });

  it("throws for an unknown spec and for an unknown sha", () => {
    const { root, dir } = setup();
    assert.throws(() => planStale(root, { planDir: dir, sessionId: "1", specId: "4.4" }), /4\.4/);
    const session = loadSession(dir, "1");
    saveSession(dir, { ...session, packages: [{ ...session.packages[0], sha: "deadbeef00" }] });
    assert.throws(() => planStale(root, { planDir: dir, sessionId: "1", specId: "1.1" }), /deadbeef00/);
  });
});

describe("plan.mjs stale", () => {
  const run = (cwd, ...args) => spawnSync("node", [cli, ...args], { cwd, encoding: "utf8" });

  it("exit 0 and silent when fresh", () => {
    const { root } = setup();
    const result = run(root, "stale", "1", "1.1");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
  });

  it("exit 1 listing the changed paths", () => {
    const { root } = setup();
    write(root, "src/b.mjs", "v2\n");
    commit(root, "change b");
    const result = run(root, "stale", "1", "1.1");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /^src\/b\.mjs$/m);
    assert.doesNotMatch(result.stdout, /other/);
  });
});
