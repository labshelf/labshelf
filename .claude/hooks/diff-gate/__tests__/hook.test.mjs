import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { hook, makeClone } from "./helpers.mjs";

let clone;
let log;
const session = `hook-test-${process.pid}-${Date.now()}`;
const stateFile = (id) => join(tmpdir(), `diff-gate-state-${id}.json`);
const logged = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);

before(() => {
  clone = makeClone("hook");
  log = join(clone.parent, "gate.jsonl");
});
after(() => {
  rmSync(stateFile(session), { force: true });
  clone.dispose();
});

describe("--hook mode", () => {
  it("logs to .git/labshelf-logs/diff-gate.jsonl of the repo when DIFF_GATE_LOG is not set", () => {
    const run = hook(clone, { env: { DIFF_GATE_LOG: "" }, input: { session_id: session } });
    assert.equal(run.status, 0);
    const file = join(clone.dir, ".git", "labshelf-logs", "diff-gate.jsonl");
    assert.ok(existsSync(file));
    assert.equal(JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1)).session_id, session);
  });

  it("is silent on a clean tree and logs one allow line", () => {
    const env = { DIFF_GATE_LOG: log };
    const run = hook(clone, { env, input: { session_id: session, agent_type: "main" } });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    const [entry] = logged();
    assert.equal(entry.decision, "allow");
    assert.equal(entry.event, "Stop");
    assert.equal(entry.changed_files, 0);
  });

  it("blocks with a decision and reason, logs it, and lets the 4th consecutive Stop through", () => {
    clone.write(".claude/settings.json", "{}\n");
    const env = { DIFF_GATE_LOG: log, DIFF_GATE_CHECKS: "forbidden" };
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      const run = hook(clone, { env, input: { session_id: session, stop_hook_active: i > 0, hook_event_name: i === 1 ? "SubagentStop" : "Stop", agent_type: "worker" } });
      assert.equal(run.status, 0);
      outcomes.push(run.decision?.decision ?? "silent");
      if (run.decision) {
        assert.ok(run.decision.reason.length <= 1500);
        assert.match(run.decision.reason, /\.claude\/settings\.json/);
      }
    }
    assert.deepEqual(outcomes, ["block", "block", "block", "silent"]);
    const entries = logged().slice(1);
    assert.deepEqual(entries.map((e) => e.decision), ["block", "block", "block", "allow_capped"]);
    assert.equal(entries[1].event, "SubagentStop");
    assert.deepEqual(entries[0].violations, { "forbidden-path": 1 });
  });

  it("resets the block counter once the tree is clean", () => {
    clone.reset();
    const env = { DIFF_GATE_LOG: log, DIFF_GATE_CHECKS: "forbidden" };
    assert.equal(hook(clone, { env, input: { session_id: session, stop_hook_active: true } }).decision, null);
    clone.write(".claude/settings.json", "{}\n");
    assert.equal(hook(clone, { env, input: { session_id: session, stop_hook_active: true } }).decision?.decision, "block");
  });

  it("DIFF_GATE_MAX_BLOCKS changes the cap", () => {
    const other = `${session}-cap1`;
    const env = { DIFF_GATE_CHECKS: "forbidden", DIFF_GATE_MAX_BLOCKS: "1" };
    try {
      assert.equal(hook(clone, { env, input: { session_id: other } }).decision?.decision, "block");
      assert.equal(hook(clone, { env, input: { session_id: other, stop_hook_active: true } }).decision, null);
    } finally {
      rmSync(stateFile(other), { force: true });
    }
  });
});
