import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { GATE, cli, git, hook, makeClone } from "./helpers.mjs";

const VIEW = "packages/vscode/src/spaces/view.ts";
let clone;
let log;
const ids = [];
const sessionId = (label) => {
  const id = `session-test-${label}-${process.pid}-${Date.now()}`;
  ids.push(id);
  return id;
};
const logged = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : []);
const sessionStart = (id) => spawnSync(process.execPath, [GATE, "--session-start"], { encoding: "utf8", input: JSON.stringify({ session_id: id, cwd: clone.dir, hook_event_name: "SessionStart" }) });

before(() => {
  clone = makeClone("session");
  log = join(clone.parent, "gate.jsonl");
});
after(() => {
  for (const id of ids) {
    rmSync(join(tmpdir(), `diff-gate-base-${id}.json`), { force: true });
    rmSync(join(tmpdir(), `diff-gate-state-${id}.json`), { force: true });
  }
  clone.dispose();
});
afterEach(() => {
  git(clone.dir, "reset", "--hard", "-q", clone.baseline); // inside the throwaway clone: drop commits the test made
  clone.reset();
  rmSync(log, { force: true });
});

describe("annotations from the real checks", () => {
  it("unused-export carries kind and localRefs", () => {
    clone.append(VIEW, "\nexport function annotatedUsed(): number {\n  return 1;\n}\nexport const annotatedDead = 2;\nvoid annotatedUsed();\n");
    const { json } = cli(clone, { checks: "knip" });
    const byName = Object.fromEntries(json.violations.filter((v) => v.kind === "unused-export").map((v) => [v.symbol, v.annotation]));
    assert.equal(byName.annotatedUsed.kind, "function");
    assert.equal(byName.annotatedUsed.localRefs, 1);
    assert.equal(byName.annotatedDead.kind, "const");
    assert.equal(byName.annotatedDead.localRefs, 0);
  });

  it("unused-file carries configRefs", () => {
    clone.write("packages/vscode/src/spaces/orphanAnnotated.ts", "export const orphanAnnotated = 1;\n");
    const { json } = cli(clone, { checks: "knip" });
    const hit = json.violations.find((v) => v.kind === "unused-file");
    assert.ok(hit, JSON.stringify(json));
    assert.equal(hit.annotation.configRefs, 0);
  });

  it("source-rule carries ruleClass", () => {
    clone.append(VIEW, "\n// eslint-disable-next-line no-console\nconsole.log('x');\n");
    const { json } = cli(clone, { checks: "rules" });
    assert.deepEqual(json.violations.map((v) => v.annotation), [{ ruleClass: "eslint-disable" }]);
  });

  it("--policy adds an action and silent violations do not fail the exit code", () => {
    clone.append(VIEW, "\nexport const policyDead = 2;\n");
    assert.equal(cli(clone, { checks: "knip", args: ["--base", "HEAD", "--policy", "a"] }).status, 1);
    const d = cli(clone, { checks: "knip", args: ["--base", "HEAD", "--policy", "d"] });
    assert.equal(d.status, 0);
    assert.equal(d.json.violations[0].action, "silent");
  });
});

describe("session base", () => {
  it("--session-start prints nothing and the hook then sees changes committed during the session", () => {
    const id = sessionId("commit");
    const started = sessionStart(id);
    assert.equal(started.status, 0);
    assert.equal(started.stdout, "");
    clone.write(".claude/settings.json", "{}\n");
    clone.commit("agent commits its work");
    const env = { DIFF_GATE_LOG: log, DIFF_GATE_CHECKS: "forbidden", DIFF_GATE_BASE: "" };
    const withBase = hook(clone, { env, input: { session_id: id } });
    assert.equal(withBase.decision?.decision, "block");
    assert.match(withBase.decision.reason, /\.claude\/settings\.json/);
    assert.equal(logged()[0].base, clone.baseline);
    const without = hook(clone, { env, input: { session_id: sessionId("none") } });
    assert.equal(without.decision, null, "a session without a record is left alone");
  });

  it("DIFF_GATE_BASE overrides the recorded base", () => {
    const id = sessionId("override");
    sessionStart(id);
    clone.write("noise.txt", "noise\n");
    const head = clone.commit("noise");
    clone.write(".claude/other.json", "{}\n");
    const env = { DIFF_GATE_CHECKS: "forbidden", DIFF_GATE_BASE: head };
    const run = hook(clone, { env, input: { session_id: id } });
    assert.equal(run.decision?.decision, "block");
    assert.match(run.decision.reason, /other\.json/);
    assert.doesNotMatch(run.decision.reason, /settings\.json/);
  });

  it("an unresolvable recorded base does nothing", () => {
    const id = sessionId("stale");
    writeFileSync(join(tmpdir(), `diff-gate-base-${id}.json`), JSON.stringify({ base: "0".repeat(40), root: clone.dir }));
    clone.write(".claude/settings.json", "{}\n");
    const run = hook(clone, { env: { DIFF_GATE_CHECKS: "forbidden", DIFF_GATE_LOG: log, DIFF_GATE_BASE: "" }, input: { session_id: id } });
    assert.equal(run.decision, null);
    assert.equal(logged()[0].decision, "no_session");
  });
});

describe("session that starts dirty", () => {
  const env = { DIFF_GATE_BASE: "", DIFF_GATE_CHECKS: "knip,forbidden,rules,jscpd" };
  const stop = (id, extra = {}) => hook(clone, { env: { ...env, DIFF_GATE_LOG: log, ...extra }, input: { session_id: id } });

  it("tracked and untracked work that was there at SessionStart is not the session's change", () => {
    clone.append(VIEW, "\nexport const preexistingDead = 1;\n");
    clone.write(".claude/preexisting.json", "{}\n");
    clone.write("packages/vscode/src/spaces/preexistingOrphan.ts", "export const preexistingOrphan = 1;\n");
    const id = sessionId("dirty");
    sessionStart(id);
    const run = stop(id, { DIFF_GATE_POLICY: "a" });
    assert.equal(run.decision, null, run.stdout);
    assert.equal(logged()[0].changed_files, 0);
    assert.match(readFileSync(join(clone.dir, VIEW), "utf8"), /export const preexistingDead/, "nothing was autofixed");
  });

  it("flags only what the session adds on top of the dirty tree", () => {
    clone.append(VIEW, "\nexport const preexistingDead = 1;\n");
    clone.write("packages/vscode/src/spaces/preexistingOrphan.ts", "export const preexistingOrphan = 1;\n");
    const id = sessionId("dirty-plus");
    sessionStart(id);
    clone.append(VIEW, "\nexport const sessionDead = 2;\n");
    clone.write(".claude/session.json", "{}\n");
    const run = stop(id, { DIFF_GATE_POLICY: "a" });
    assert.equal(run.decision?.decision, "block");
    assert.match(run.decision.reason, /sessionDead/);
    assert.match(run.decision.reason, /\.claude\/session\.json/);
    assert.doesNotMatch(run.decision.reason, /preexisting/);
  });

  it("an untracked file the session edits counts again", () => {
    clone.write("packages/vscode/src/spaces/preexistingOrphan.ts", "export const preexistingOrphan = 1;\n");
    const id = sessionId("dirty-edit");
    sessionStart(id);
    assert.equal(stop(id, { DIFF_GATE_POLICY: "a" }).decision, null);
    clone.append("packages/vscode/src/spaces/preexistingOrphan.ts", "export const editedLater = 2;\n");
    const run = stop(id, { DIFF_GATE_POLICY: "a" });
    assert.equal(run.decision?.decision, "block");
    assert.match(run.decision.reason, /preexistingOrphan/);
  });

  it("the record keeps the tree untouched and a clean tree records HEAD", () => {
    const id = sessionId("clean");
    sessionStart(id);
    assert.equal(git(clone.dir, "status", "--porcelain"), "");
    const record = JSON.parse(readFileSync(join(tmpdir(), `diff-gate-base-${id}.json`), "utf8"));
    assert.equal(record.base, clone.baseline);
    assert.deepEqual(record.untracked, {});
  });

  it("a staged new file at SessionStart is part of the base", () => {
    clone.write(".claude/staged.json", "{}\n");
    git(clone.dir, "add", ".claude/staged.json");
    const id = sessionId("staged");
    sessionStart(id);
    assert.equal(stop(id, { DIFF_GATE_POLICY: "a" }).decision, null);
  });

  it("pre-commit does not autofix a session that has no record", () => {
    clone.append(VIEW, "\nexport function noRecord(): number {\n  return 1;\n}\nvoid noRecord();\n");
    const run = spawnSync(process.execPath, [GATE, "--pre-commit"], {
      encoding: "utf8",
      input: JSON.stringify({ cwd: clone.dir, tool_name: "Bash", tool_input: { command: "git commit -am x" }, session_id: sessionId("norec") }),
      env: { ...process.env, DIFF_GATE_POLICY: "f", DIFF_GATE_BASE: "", DIFF_GATE_CHECKS: "knip" },
    });
    assert.equal(run.status, 0);
    assert.match(readFileSync(join(clone.dir, VIEW), "utf8"), /export function noRecord/);
  });
});

describe("autofix in hook mode", () => {
  it("an autofix-only diff does not block, edits the file and is logged", () => {
    clone.append(VIEW, "\nexport function fixedByGate(): number {\n  return 1;\n}\nvoid fixedByGate();\n");
    const env = { DIFF_GATE_LOG: log, DIFF_GATE_CHECKS: "knip" };
    const run = hook(clone, { env, input: { session_id: sessionId("autofix") } });
    assert.equal(run.status, 0);
    assert.equal(run.decision, null, run.stdout);
    const text = readFileSync(join(clone.dir, VIEW), "utf8");
    assert.match(text, /^function fixedByGate\(\): number \{$/m);
    assert.doesNotMatch(text, /export function fixedByGate/);
    const [entry] = logged();
    assert.equal(entry.decision, "allow");
    assert.equal(entry.policy, "d");
    assert.equal(entry.autofixed.length, 1);
    assert.match(entry.autofixed[0], new RegExp(`^${VIEW}:\\d+:fixedByGate$`));
  });

  it("still blocks on the rest when autofixes happen alongside a blocking violation", () => {
    clone.append(VIEW, "\nexport function alsoFixed(): number {\n  return 1;\n}\nvoid alsoFixed();\n");
    clone.write(".claude/settings.json", "{}\n");
    const env = { DIFF_GATE_LOG: log, DIFF_GATE_CHECKS: "knip,forbidden" };
    const run = hook(clone, { env, input: { session_id: sessionId("mixed") } });
    assert.equal(run.decision?.decision, "block");
    assert.doesNotMatch(run.decision.reason, /alsoFixed/);
    assert.equal(logged()[0].autofixed.length, 1);
  });

  it("policy a blocks the same diff without editing anything", () => {
    clone.append(VIEW, "\nexport function keptByA(): number {\n  return 1;\n}\nvoid keptByA();\n");
    const env = { DIFF_GATE_CHECKS: "knip", DIFF_GATE_POLICY: "a" };
    const run = hook(clone, { env, input: { session_id: sessionId("policy-a") } });
    assert.equal(run.decision?.decision, "block");
    assert.match(readFileSync(join(clone.dir, VIEW), "utf8"), /export function keptByA/);
  });
});
