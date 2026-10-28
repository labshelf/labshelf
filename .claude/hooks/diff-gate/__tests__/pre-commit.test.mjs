import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, before, describe, it } from "node:test";
import { detectCommit, splitSegments } from "../commit-command.mjs";
import { GATE, git, makeClone } from "./helpers.mjs";

describe("detectCommit", () => {
  const at = (command) => detectCommit(command, "/w");
  it("finds plain and chained commits", () => {
    assert.deepEqual(at('git commit -m "x"'), { dir: "/w" });
    assert.deepEqual(at('git add -A && git commit -m "x"'), { dir: "/w" });
    assert.deepEqual(at("git add . ; git commit -m x"), { dir: "/w" });
    assert.deepEqual(at("git status | cat\ngit commit -m x"), { dir: "/w" });
    assert.deepEqual(at("GIT_AUTHOR_NAME=a git commit -m x"), { dir: "/w" });
    assert.deepEqual(at('git commit -m "$(cat <<\'EOF\'\nmsg\nEOF\n)"'), { dir: "/w" });
    assert.deepEqual(at("(git add -A && git commit -m x)"), { dir: "/w" });
  });
  it("follows cd and git -C", () => {
    assert.deepEqual(at("cd x && git commit -m y"), { dir: "/w/x" });
    assert.deepEqual(at("cd /abs/r && git add -A && git commit -m y"), { dir: "/abs/r" });
    assert.deepEqual(at("git -C sub commit -m y"), { dir: "/w/sub" });
    assert.deepEqual(at("git -c user.name=a --no-pager commit -m y"), { dir: "/w" });
  });
  it("treats --amend as a commit", () => {
    assert.deepEqual(at("git commit --amend --no-edit"), { dir: "/w" });
  });
  it("ignores everything else", () => {
    for (const command of ["git status", "git log --oneline", "git add -A", "ls && echo commit", 'echo "git commit -m x"', "echo 'a && git commit'", "git config alias.commit x", "gitx commit", "npm run commit", "", undefined, 42]) {
      assert.equal(at(command), null, String(command));
    }
  });
  it("splitSegments keeps quoted operators inside words", () => {
    assert.deepEqual(splitSegments('echo "a && b" && ls'), [["echo", "a && b"], ["ls"]]);
  });
});

const VIEW = "packages/vscode/src/spaces/view.ts";
const FIXABLE = "\nexport function preFixed(): number {\n  return 1;\n}\nvoid preFixed();\n";
let clone;
const ids = [];
const sid = (label) => {
  const id = `precommit-${label}-${process.pid}-${Date.now()}`;
  ids.push(id);
  return id;
};
const env = (extra = {}) => ({ DIFF_GATE_POLICY: "f", DIFF_GATE_BASE: "HEAD", DIFF_GATE_CHECKS: "knip,forbidden,rules", ...extra });
const preCommit = (command, { input = {}, extraEnv = {}, raw } = {}) =>
  spawnSync(process.execPath, [GATE, "--pre-commit"], {
    encoding: "utf8",
    input: raw ?? JSON.stringify({ cwd: clone.dir, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command }, session_id: sid("x"), ...input }),
    env: { ...process.env, ...env(extraEnv) },
  });
const stop = (session_id, extraEnv = {}) =>
  spawnSync(process.execPath, [GATE, "--hook"], { encoding: "utf8", input: JSON.stringify({ cwd: clone.dir, hook_event_name: "Stop", stop_hook_active: false, session_id }), env: { ...process.env, ...env(extraEnv) } });
const viewText = () => readFileSync(join(clone.dir, VIEW), "utf8");

before(() => {
  clone = makeClone("precommit");
});
after(() => {
  for (const id of ids) rmSync(join(tmpdir(), `diff-gate-state-${id}.json`), { force: true });
  clone.dispose();
});
afterEach(() => {
  git(clone.dir, "reset", "--hard", "-q", clone.baseline);
  clone.reset();
});

describe("--pre-commit", () => {
  it("autofixes and stages the fix so the following commit contains it; output is empty", () => {
    clone.append(VIEW, FIXABLE);
    const run = preCommit('git add -A && git commit -m "feat"');
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.doesNotMatch(viewText(), /export function preFixed/);
    assert.equal(git(clone.dir, "diff", "--name-only"), "", "nothing left unstaged");
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), VIEW);
    git(clone.dir, "commit", "--no-verify", "-q", "-m", "feat");
    assert.equal(git(clone.dir, "status", "--porcelain"), "");
    assert.match(git(clone.dir, "show", "HEAD:" + VIEW), /\nfunction preFixed/);
  });

  it("works for `cd <repo> && git commit` run from another cwd, and for committed-later new files", () => {
    clone.append(VIEW, FIXABLE);
    const run = preCommit(`cd ${clone.dir} && git commit -am x`, { input: { cwd: tmpdir() } });
    assert.equal(run.stdout, "");
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), VIEW);
  });

  it("uses the recorded session base: work committed earlier in the session is fixed too", () => {
    clone.append(VIEW, FIXABLE);
    const base = clone.baseline;
    clone.commit("early");
    const run = preCommit("git commit --allow-empty -m next", { extraEnv: { DIFF_GATE_BASE: base } });
    assert.equal(run.stdout, "");
    assert.doesNotMatch(viewText(), /export function preFixed/);
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), VIEW);
  });

  it("leaves non-commit commands and other tools alone", () => {
    clone.append(VIEW, FIXABLE);
    for (const command of ["git status", "git add -A", 'echo "git commit"', "ls"]) assert.equal(preCommit(command).stdout, "");
    const other = preCommit("git commit -m x", { input: { tool_name: "Edit" } });
    assert.equal(other.status, 0);
    assert.match(viewText(), /export function preFixed/);
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), "");
  });

  it("only autofix actions: dead exports and blocks are not touched, nothing printed", () => {
    clone.append(VIEW, "\nexport const preDead = 1;\n// eslint-disable-next-line no-console\nconsole.log('x');\n");
    const run = preCommit("git commit -am x");
    assert.equal(run.status, 0);
    assert.equal(run.stdout, "");
    assert.match(viewText(), /export const preDead/);
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), "");
  });

  it("stages only the files it edited", () => {
    clone.append(VIEW, FIXABLE);
    clone.write("notes-unrelated.txt", "x\n");
    preCommit("git commit -am x");
    assert.equal(git(clone.dir, "diff", "--cached", "--name-only"), VIEW);
  });

  it("any error is silent: bad stdin, empty stdin, unknown cwd, git add failure", () => {
    for (const raw of ["not json", "", "{}", JSON.stringify({ tool_name: "Bash", tool_input: { command: "git commit -m x" }, cwd: "/nonexistent-dir-xyz" })]) {
      const run = preCommit("", { raw });
      assert.equal(run.status, 0);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, "");
    }
    clone.append(VIEW, FIXABLE);
    git(clone.dir, "config", "core.excludesFile", "/dev/null");
    const lock = join(clone.dir, ".git", "index.lock");
    spawnSync("touch", [lock]);
    try {
      const run = preCommit("git commit -am x");
      assert.equal(run.status, 0);
      assert.equal(run.stdout, "");
      assert.equal(run.stderr, "");
    } finally {
      rmSync(lock, { force: true });
    }
  });

  it("Stop afterwards does not notify about what was autofixed, nor fix anything again", () => {
    const id = sid("stop");
    clone.append(VIEW, FIXABLE + "export const stopDead = 1;\n");
    preCommit("git commit -am x", { input: { session_id: id } });
    git(clone.dir, "commit", "--no-verify", "-q", "-am", "x");
    const run = stop(id, { DIFF_GATE_BASE: clone.baseline });
    assert.equal(run.status, 0);
    const message = JSON.parse(run.stdout).systemMessage;
    assert.match(message, /stopDead/);
    assert.doesNotMatch(message, /preFixed/);
    assert.equal(git(clone.dir, "status", "--porcelain"), "", "tree stays clean after Stop");
  });

  it("logs the autofix and the staged files", () => {
    const log = join(clone.parent, "gate.jsonl");
    clone.append(VIEW, FIXABLE);
    preCommit("git commit -am x", { extraEnv: { DIFF_GATE_LOG: log } });
    const line = JSON.parse(readFileSync(log, "utf8").trim().split("\n").at(-1));
    assert.equal(line.mode, "pre-commit");
    assert.deepEqual(line.staged, [VIEW]);
    assert.match(line.autofixed[0], /view\.ts:\d+:preFixed/);
  });
});
