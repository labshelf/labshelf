import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { loadPlan, loadSession, savePlan } from "../planFiles.mjs";
import { planLint } from "../planLint.mjs";
import { planNew } from "../planNew.mjs";

const cli = fileURLToPath(new URL("../plan.mjs", import.meta.url));
const tempRepo = () => {
  const root = mkdtempSync(join(tmpdir(), "plan-new-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
};

describe("planNew", () => {
  it("creates plan.yaml, sessions/1.yaml, log.md and an empty research folder", () => {
    const root = tempRepo();
    const dir = planNew(root, { slug: "demo", level: "N3", title: "Demo plan" });
    assert.equal(dir, join(root, "documents", "plans", "demo"));
    assert.deepEqual(readdirSync(dir).sort(), ["log.md", "plan.yaml", "research", "sessions"]);
    assert.deepEqual(readdirSync(join(dir, "research")), []);
    const plan = loadPlan(dir);
    assert.equal(plan.status, "draft");
    assert.equal(plan.level, "N3");
    assert.equal(plan.title, "Demo plan");
    const session = loadSession(dir, "1");
    assert.equal(session.status, "pending");
    assert.deepEqual(session.packages, []);
    assert.match(readFileSync(join(dir, "log.md"), "utf8"), /^# Log: Demo plan\n\n<!-- Append-only\./);
  });

  it("writes the schema key first", () => {
    const root = tempRepo();
    const dir = planNew(root, { slug: "demo", level: "N2" });
    assert.match(readFileSync(join(dir, "plan.yaml"), "utf8"), /^schema: plan\/v1\n/);
    assert.match(readFileSync(join(dir, "sessions", "1.yaml"), "utf8"), /^schema: session\/v1\n/);
  });

  it("defaults the title to the slug", () => {
    const root = tempRepo();
    assert.equal(loadPlan(planNew(root, { slug: "demo", level: "N2" })).title, "demo");
  });

  it("produces a plan that passes lint", () => {
    const root = tempRepo();
    const dir = planNew(root, { slug: "demo", level: "N2" });
    assert.deepEqual(planLint(root, dir), []);
  });

  it("refuses an existing folder, a bad slug and a bad level", () => {
    const root = tempRepo();
    planNew(root, { slug: "demo", level: "N2" });
    assert.throws(() => planNew(root, { slug: "demo", level: "N2" }), /already exists/);
    assert.throws(() => planNew(root, { slug: "Bad Slug", level: "N2" }), /slug/);
    assert.throws(() => planNew(root, { slug: "other", level: "N1" }), /--level/);
    assert.equal(existsSync(join(root, "documents", "plans", "other")), false);
  });
});

describe("planFiles", () => {
  it("savePlan replaces a misplaced schema key and rejects invalid plans", () => {
    const root = tempRepo();
    const dir = planNew(root, { slug: "demo", level: "N2" });
    const plan = loadPlan(dir);
    savePlan(dir, { ...plan, schema: "plan/v1", goal: "changed" });
    assert.equal(loadPlan(dir).goal, "changed");
    assert.throws(() => savePlan(dir, { ...plan, status: "bogus" }), /status/);
  });
});

describe("plan.mjs", () => {
  const run = (cwd, ...args) => spawnSync("node", [cli, ...args], { cwd, encoding: "utf8" });

  it("new then lint: exit 0, lint prints nothing", () => {
    const root = tempRepo();
    const created = run(root, "new", "demo", "--level", "N2", "--title", "Demo");
    assert.equal(created.status, 0, created.stderr);
    const linted = run(root, "lint", "documents/plans/demo");
    assert.equal(linted.status, 0, linted.stderr);
    assert.equal(linted.stdout, "");
    assert.equal(linted.stderr, "");
  });

  it("errors go to stderr with exit 1", () => {
    const root = tempRepo();
    const bad = run(root, "new", "demo");
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /--level/);
    assert.equal(run(root, "nope").status, 1);
  });
});
