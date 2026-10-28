import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { loadSession, saveSession } from "../planFiles.mjs";
import { planNew } from "../planNew.mjs";
import { pendingSessions, planQueue } from "../planQueue.mjs";

let root;
before(() => {
  root = mkdtempSync(join(tmpdir(), "plan-queue-"));
});
after(() => rmSync(root, { recursive: true, force: true }));

let counter = 0;
// A YAML plan whose sessions are `[id, status, depends_on]` rows; `planNew` makes session 1, which is replaced or removed.
const yamlPlan = (rows) => {
  const dir = planNew(join(root, `case-${counter++}`), { slug: "demo", level: "N2" });
  rmSync(join(dir, "sessions", "1.yaml"));
  for (const [id, status, depends_on = []] of rows) {
    saveSession(dir, { id, goal: "g", depends_on, owns: [], status, packages: [] });
  }
  return dir;
};

const mdPlan = (names) => {
  const dir = join(root, `md-${counter++}`);
  mkdirSync(join(dir, "sessions"), { recursive: true });
  writeFileSync(join(dir, "plan.md"), "Status: approved\n");
  for (const name of names) writeFileSync(join(dir, "sessions", `${name}.md`), "# s\n");
  return dir;
};

const ids = (dir) => pendingSessions(dir).map((e) => e.id);

describe("pendingSessions for .md plans", () => {
  it("orders by numeric prefix, then suffix", () => {
    const dir = mdPlan(["10", "2b", "1", "10a", "2", "10-rest"]);
    assert.deepEqual(ids(dir), ["1", "2", "2b", "10", "10-rest", "10a"]);
  });

  it("returns id, file and format", () => {
    const dir = mdPlan(["1"]);
    assert.deepEqual(pendingSessions(dir), [{ id: "1", file: join(dir, "sessions", "1.md"), format: "md" }]);
  });

  it("is empty without a sessions folder", () => {
    const dir = join(root, "empty");
    mkdirSync(dir);
    assert.deepEqual(pendingSessions(dir), []);
  });
});

describe("pendingSessions for YAML plans", () => {
  it("orders by depends_on, with numeric id order as the tie-break", () => {
    const dir = yamlPlan([
      ["10", "pending"],
      ["2", "pending", ["10"]],
      ["3", "pending"],
      ["1", "pending", ["3"]],
    ]);
    assert.deepEqual(ids(dir), ["3", "1", "10", "2"]);
  });

  it("returns id, file and format", () => {
    const dir = yamlPlan([["1", "pending"]]);
    assert.deepEqual(pendingSessions(dir), [{ id: "1", file: join(dir, "sessions", "1.yaml"), format: "yaml" }]);
  });

  it("skips a session that depends directly or transitively on a blocked one, and says why", () => {
    const dir = yamlPlan([
      ["1", "blocked"],
      ["2", "pending", ["1"]],
      ["3", "pending", ["2"]],
      ["4", "pending"],
      ["5", "pending", ["4"]],
    ]);
    const { queue, skipped } = planQueue(dir);
    assert.deepEqual(queue.map((e) => e.id), ["4", "5"]);
    assert.deepEqual(skipped.map((s) => s.id), ["2", "3"]);
    assert.match(skipped[0].reason, /blocked session 1/);
    assert.match(skipped[1].reason, /blocked session 1/);
  });

  it("treats a dependency without a session file (closed) or marked done as satisfied", () => {
    const dir = yamlPlan([
      ["2", "pending", ["1"]],
      ["3", "pending", ["4"]],
      ["4", "done"],
    ]);
    assert.deepEqual(ids(dir), ["2", "3"]);
  });

  it("never lists blocked or done sessions", () => {
    const dir = yamlPlan([["1", "done"], ["2", "blocked"], ["3", "pending"]]);
    assert.deepEqual(ids(dir), ["3"]);
  });

  it("leaves a dependency cycle out and reports it", () => {
    const dir = yamlPlan([["1", "pending", ["2"]], ["2", "pending", ["1"]], ["3", "pending"]]);
    const { queue, skipped } = planQueue(dir);
    assert.deepEqual(queue.map((e) => e.id), ["3"]);
    assert.deepEqual(skipped.map((s) => s.id), ["1", "2"]);
    assert.match(skipped[0].reason, /cycle/);
  });

  it("reads status from the session files, so a session that becomes blocked drops out", () => {
    const dir = yamlPlan([["1", "pending"], ["2", "pending", ["1"]]]);
    assert.deepEqual(ids(dir), ["1", "2"]);
    saveSession(dir, { ...loadSession(dir, "1"), status: "blocked", blocked_reason: "needs a decision" });
    assert.deepEqual(ids(dir), []);
  });
});
