import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { applyPolicy, decide, normalizeVariant } from "../policy.mjs";
import { formatNotice, violationKey } from "../report.mjs";
import { git, hook, makeClone } from "./helpers.mjs";

const exp = (localRefs) => ({ kind: "unused-export", file: "a.ts", line: 1, symbol: "x", annotation: { kind: "const", localRefs } });
const rule = (ruleClass) => ({ kind: "source-rule", file: "a.ts", annotation: { ruleClass } });
const plain = (kind) => ({ kind, file: "a.ts" });
const file = { kind: "unused-file", file: "a.ts", line: 1, annotation: { configRefs: 0 } };

describe("policy f decisions", () => {
  it("is the default variant", () => {
    assert.equal(normalizeVariant(undefined), "f");
    assert.equal(normalizeVariant("zzz"), "f");
    assert.equal(normalizeVariant("F"), "f");
  });
  it("autofixes local-use exports, notifies dead ones and unused files", () => {
    assert.equal(decide(exp(2)), "autofix");
    assert.equal(decide(exp(0)), "notify");
    assert.equal(decide(file), "notify");
  });
  it("blocks clones and suppressions, notifies other rules", () => {
    assert.equal(decide(plain("clone")), "block");
    for (const cls of ["eslint-disable", "ts-ignore", "test-skip"]) assert.equal(decide(rule(cls)), "block");
    for (const cls of ["commented-code", "other"]) assert.equal(decide(rule(cls)), "notify");
  });
  it("blocks forbidden edits on SubagentStop only", () => {
    for (const kind of ["forbidden-path", "forbidden-script"]) {
      assert.equal(decide(plain(kind), "f", { subagent: true }), "block");
      assert.equal(decide(plain(kind), "f", { subagent: false }), "notify");
      assert.equal(decide(plain(kind), "f"), "notify");
    }
  });
  it("applyPolicy has a notify bucket and leaves silent empty", () => {
    const list = [exp(1), exp(0), plain("clone"), plain("forbidden-path")];
    const out = applyPolicy(list, "f", { subagent: false });
    assert.deepEqual(out, { block: [list[2]], autofix: [list[0]], notify: [list[1], list[3]], silent: [] });
  });
  it("older variants never notify", () => {
    for (const variant of ["a", "b", "c", "d"]) assert.deepEqual(applyPolicy([exp(0), exp(1), file, rule("other")], variant).notify, []);
  });
});

describe("notice format", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => ({ kind: "unused-export", file: `f${i}.ts`, line: i + 1, symbol: `s${i}`, message: `unused export s${i}` }));
  it("lists up to 7 items without a tail", () => {
    const lines = formatNotice(many(7)).split("\n");
    assert.equal(lines.length, 8);
    assert.doesNotMatch(lines.join("\n"), /more/);
  });
  it("caps at 8 lines with +N more", () => {
    const lines = formatNotice(many(20)).split("\n");
    assert.equal(lines.length, 8);
    assert.equal(lines.at(-1), "+14 more");
  });
  it("keys ignore line shifts", () => {
    assert.equal(violationKey({ ...many(1)[0], line: 3 }), violationKey({ ...many(1)[0], line: 40 }));
  });
});

const VIEW = "packages/vscode/src/spaces/view.ts";
let clone;
const ids = [];
const sid = (label) => {
  const id = `policyf-${label}-${process.pid}-${Date.now()}`;
  ids.push(id);
  return id;
};
const env = (extra = {}) => ({ DIFF_GATE_POLICY: "f", DIFF_GATE_CHECKS: "knip,forbidden,rules", ...extra });

before(() => {
  clone = makeClone("policyf");
});
after(() => {
  for (const id of ids) rmSync(join(tmpdir(), `diff-gate-state-${id}.json`), { force: true });
  clone.dispose();
});
afterEach(() => {
  git(clone.dir, "reset", "--hard", "-q", clone.baseline);
  clone.reset();
});

describe("policy f in hook mode", () => {
  it("a dead export only notifies: systemMessage, no decision, file untouched", () => {
    clone.append(VIEW, "\nexport const notifiedDead = 2;\n");
    const run = hook(clone, { env: env(), input: { session_id: sid("dead") } });
    assert.equal(run.status, 0);
    assert.equal(run.decision.decision, undefined);
    assert.equal(run.decision.reason, undefined);
    assert.match(run.decision.systemMessage, /notifiedDead/);
    assert.match(readFileSync(join(clone.dir, VIEW), "utf8"), /export const notifiedDead/);
  });

  it("the same notification is not repeated on the next Stop of the session", () => {
    clone.append(VIEW, "\nexport const notifiedOnce = 2;\n");
    const input = { session_id: sid("once") };
    assert.match(hook(clone, { env: env(), input }).decision.systemMessage, /notifiedOnce/);
    assert.equal(hook(clone, { env: env(), input }).decision, null);
    clone.append(VIEW, "export const notifiedLater = 3;\n");
    const third = hook(clone, { env: env(), input }).decision;
    assert.match(third.systemMessage, /notifiedLater/);
    assert.doesNotMatch(third.systemMessage, /notifiedOnce/);
    assert.match(hook(clone, { env: env(), input: { session_id: sid("other") } }).decision.systemMessage, /notifiedOnce/, "another session is notified again");
  });

  it("autofixes a local-use export and notifies a dead one in the same run, without blocking", () => {
    clone.append(VIEW, "\nexport function fixedF(): number {\n  return 1;\n}\nvoid fixedF();\nexport const deadF = 1;\n");
    const run = hook(clone, { env: env(), input: { session_id: sid("mix") } });
    assert.equal(run.decision.decision, undefined);
    assert.match(run.decision.systemMessage, /deadF/);
    assert.doesNotMatch(run.decision.systemMessage, /fixedF/);
    assert.doesNotMatch(readFileSync(join(clone.dir, VIEW), "utf8"), /export function fixedF/);
  });

  it("a forbidden edit notifies on Stop and blocks on SubagentStop", () => {
    clone.write(".claude/settings.json", "{}\n");
    const main = hook(clone, { env: env(), input: { session_id: sid("main"), hook_event_name: "Stop" } });
    assert.equal(main.decision.decision, undefined);
    assert.match(main.decision.systemMessage, /\.claude\/settings\.json/);
    const sub = hook(clone, { env: env(), input: { session_id: sid("sub"), hook_event_name: "SubagentStop", agent_type: "general-purpose" } });
    assert.equal(sub.decision.decision, "block");
    assert.match(sub.decision.reason, /\.claude\/settings\.json/);
    assert.equal(sub.decision.systemMessage, undefined);
  });

  it("blocks and notifies together: reason holds the blocks only, systemMessage the notifies", () => {
    clone.append(VIEW, "\n// eslint-disable-next-line no-console\nconsole.log('x');\nexport const mixedDead = 1;\n");
    const run = hook(clone, { env: env(), input: { session_id: sid("both") } });
    assert.equal(run.decision.decision, "block");
    assert.match(run.decision.reason, /eslint|suppress|disable/i);
    assert.doesNotMatch(run.decision.reason, /mixedDead/);
    assert.match(run.decision.systemMessage, /mixedDead/);
    assert.doesNotMatch(run.decision.systemMessage, /eslint-disable/);
    // The block repeats until fixed; the notification does not.
    const again = hook(clone, { env: env(), input: { session_id: run.decision && ids.at(-1), stop_hook_active: true } });
    assert.equal(again.decision.decision, "block");
    assert.equal(again.decision.systemMessage, undefined);
  });

  it("notify output never carries decision even when the block cap is reached", () => {
    clone.append(VIEW, "\nexport const capDead = 1;\n");
    const input = { session_id: sid("cap"), stop_hook_active: true };
    for (let i = 0; i < 3; i++) assert.notEqual(hook(clone, { env: env(), input }).decision?.decision, "block");
  });
});
