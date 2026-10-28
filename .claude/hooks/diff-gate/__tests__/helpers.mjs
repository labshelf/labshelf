// Test helpers: one APFS clone of the labshelf checkout per test file, committed as baseline, plus runners for the gate.
// DIFF_GATE_TEST_SOURCE picks the repo to clone (default: the checkout this file is in), DIFF_GATE_TEST_TMP the folder for clones.
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GATE = join(dirname(fileURLToPath(import.meta.url)), "..", "diff-gate.mjs");
const SOURCE = process.env.DIFF_GATE_TEST_SOURCE ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

export function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// Clones SOURCE (copy-on-write, node_modules included) and commits its working tree as the baseline.
export function makeClone(label) {
  const parent = mkdtempSync(join(process.env.DIFF_GATE_TEST_TMP ?? tmpdir(), `diff-gate-${label}-`));
  const dir = join(parent, "repo");
  execFileSync("cp", ["-cR", SOURCE, dir]);
  git(dir, "add", "-A");
  git(dir, "commit", "--no-verify", "--allow-empty", "-q", "-m", "baseline");
  return {
    dir,
    parent,
    baseline: git(dir, "rev-parse", "HEAD"),
    write(rel, text) {
      mkdirSync(dirname(join(dir, rel)), { recursive: true });
      writeFileSync(join(dir, rel), text);
    },
    append(rel, text) {
      appendFileSync(join(dir, rel), text);
    },
    commit(message) {
      git(dir, "add", "-A");
      git(dir, "commit", "--no-verify", "-q", "-m", message);
      return git(dir, "rev-parse", "HEAD");
    },
    reset() {
      git(dir, "checkout", "-q", "--", ".");
      git(dir, "clean", "-fdq");
    },
    dispose() {
      rmSync(parent, { recursive: true, force: true });
    },
  };
}

export function lines(dir, rel, from, to) {
  return execFileSync("sed", ["-n", `${from},${to}p`, join(dir, rel)], { encoding: "utf8" });
}

// Runs the CLI with --json and returns the parsed result plus the exit code.
export function cli(clone, { checks, args = ["--base", "HEAD"], env = {} } = {}) {
  const run = spawnSync(process.execPath, [GATE, "--repo", clone.dir, ...args, "--json"], {
    encoding: "utf8",
    env: { ...process.env, ...(checks ? { DIFF_GATE_CHECKS: checks } : {}), ...env },
  });
  let json = null;
  try {
    json = JSON.parse(run.stdout);
  } catch {
    // Leave null: the test asserts on status and stderr.
  }
  return { status: run.status, stderr: run.stderr, json, kinds: (json?.violations ?? []).map((v) => v.kind) };
}

// Runs the Stop hook the way Claude Code does: JSON on stdin, decision on stdout.
export function hook(clone, { input = {}, env = {}, raw } = {}) {
  const run = spawnSync(process.execPath, [GATE, "--hook"], {
    encoding: "utf8",
    input: raw ?? JSON.stringify({ cwd: clone.dir, hook_event_name: "Stop", stop_hook_active: false, ...input }),
    // Tests written before policy f became the default keep running under d; tests written before the session record diff against HEAD (DIFF_GATE_BASE="" uses the record).
    env: { ...process.env, DIFF_GATE_POLICY: "d", DIFF_GATE_BASE: "HEAD", ...env },
  });
  return { status: run.status, stdout: run.stdout, stderr: run.stderr, decision: run.stdout ? JSON.parse(run.stdout) : null };
}
