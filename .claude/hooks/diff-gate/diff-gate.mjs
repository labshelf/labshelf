#!/usr/bin/env node
// Diff gate: blocks an agent from finishing while its diff introduces unused exports or files, duplicated code, source-rule regressions or edits to protected config.
// CLI:  node diff-gate.mjs --repo <dir> --base <rev> [--head <rev>] --json      (--head compares two commits instead of the working tree)
// Hook: node diff-gate.mjs --hook   (reads the Stop / SubagentStop JSON on stdin; prints {"decision":"block",...} or nothing)
// Env:  DIFF_GATE_LOG=<file> (default .git/labshelf-logs/diff-gate.jsonl) appends one JSONL line per hook run; DIFF_GATE_CHECKS=knip,jscpd,rules,forbidden limits the checks;
//       DIFF_GATE_MAX_BLOCKS=<n> consecutive blocks per session before the gate lets the agent through (default 3);
//       DIFF_GATE_POLICY=a|b|c|d|f (default f) maps violations to block / autofix / notify / silent (policy.mjs); DIFF_GATE_BASE=<rev> overrides the diff base.
// Pre-commit: `node diff-gate.mjs --pre-commit` (PreToolUse hook, matcher Bash) autofixes and stages the fix when the command runs `git commit`; never prints, never denies.
// Session base: `node diff-gate.mjs --session-start` (SessionStart hook, JSON on stdin) records the working tree (a `git stash create` commit, or HEAD when clean)
//   and the hashes of the untracked files; the Stop hook diffs against it, so work that was already there is not the session's. Without a record the hook does nothing.
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAutofixes } from "./autofix.mjs";
import { CHECKS } from "./checks.mjs";
import { detectCommit } from "./commit-command.mjs";
import { computeDiff, git, repoRoot, resolveRev, untrackedHashes } from "./git-diff.mjs";
import { applyPolicy, decide, normalizeVariant } from "./policy.mjs";
import { countByKind, formatNotice, formatReason, violationKey } from "./report.mjs";
import { createSnapshot } from "./snapshot.mjs";

function enabledChecks(only) {
  const wanted = (process.env.DIFF_GATE_CHECKS ?? "forbidden,knip,jscpd,rules").split(",").map((name) => name.trim());
  return Object.entries(CHECKS).filter(([name]) => wanted.includes(name) && (only === undefined || only.includes(name)));
}

// Runs all checks (or only the named `checks`) against `repo`. Returns { violations, errors, skipped, timings, changedFiles, durationMs } or throws on bad input.
// `skipUntracked` (Map path -> hash, from the session record) leaves out untracked files whose content is unchanged.
export async function runGate({ repo, base, head, checks, skipUntracked }) {
  const started = Date.now();
  const root = repoRoot(resolve(repo));
  if (root === null) throw new Error(`not a git repository: ${repo}`);
  const baseSha = resolveRev(root, base);
  if (baseSha === null) throw new Error(`unknown base revision: ${base}`);
  const headSha = head ? resolveRev(root, head) : null;
  if (head && headSha === null) throw new Error(`unknown head revision: ${head}`);

  const snapshot = headSha ? createSnapshot(root, headSha) : null;
  try {
    const workRoot = snapshot ? snapshot.dir : root;
    let skippedUntracked;
    if (skipUntracked?.size > 0 && !snapshot) {
      const now = untrackedHashes(workRoot);
      skippedUntracked = new Set([...skipUntracked].filter(([rel, hash]) => now.get(rel) === hash).map(([rel]) => rel));
    }
    const diff = computeDiff(workRoot, baseSha, headSha ? "HEAD" : undefined, skippedUntracked);
    if (diff === null) throw new Error("git diff failed");
    const result = { violations: [], errors: [], skipped: [], timings: {}, changedFiles: diff.size };
    if (diff.size > 0) {
      const ctx = { root: workRoot, toolsRoot: process.env.DIFF_GATE_TOOLS_ROOT ?? root, base: baseSha, head: headSha ? "HEAD" : null, diff, skippedUntracked };
      const outcomes = await Promise.all(enabledChecks(checks).map(async ([name, check]) => [name, await check(ctx)]));
      for (const [name, outcome] of outcomes) {
        result.timings[name] = outcome.ms;
        if (outcome.error) result.errors.push(`${name}: ${outcome.error}`);
        if (outcome.skipped) result.skipped.push(`${name}: ${outcome.skipped}`);
        result.violations.push(...outcome.violations);
      }
    }
    result.durationMs = Date.now() - started;
    return { root, base: baseSha, head: headSha, ...result };
  } finally {
    snapshot?.dispose();
  }
}

function parseArgs(argv) {
  const args = { json: false, hook: false, sessionStart: false, preCommit: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--repo") args.repo = argv[++i];
    else if (flag === "--base") args.base = argv[++i];
    else if (flag === "--head") args.head = argv[++i];
    else if (flag === "--json") args.json = true;
    else if (flag === "--hook") args.hook = true;
    else if (flag === "--session-start") args.sessionStart = true;
    else if (flag === "--pre-commit") args.preCommit = true;
    else if (flag === "--policy") args.policy = argv[++i];
  }
  return args;
}

function cli(args) {
  return runGate({ repo: args.repo ?? process.cwd(), base: args.base ?? "HEAD", head: args.head }).then(
    (result) => {
      // With --policy every violation gets an `action`, and silent ones do not count towards the exit code.
      const policy = args.policy === undefined ? null : normalizeVariant(args.policy);
      const actions = policy === null ? null : new Map(result.violations.map((v) => [v, decide(v, policy)]));
      if (actions) for (const violation of result.violations) violation.action = actions.get(violation);
      const shown = actions ? result.violations.filter((v) => v.action !== "silent") : result.violations;
      if (args.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      else {
        process.stdout.write(shown.length === 0 ? "diff gate: clean\n" : `${formatReason(shown)}\n`);
        for (const error of result.errors) process.stderr.write(`tool error: ${error}\n`);
      }
      return shown.length > 0 ? 1 : 0;
    },
    (error) => {
      process.stderr.write(`diff gate: ${error.message}\n`);
      return 2;
    },
  );
}

const MAX_BLOCKS = Number(process.env.DIFF_GATE_MAX_BLOCKS ?? 3);
const stateFile = (sessionId) => join(tmpdir(), `diff-gate-state-${String(sessionId ?? "none").replace(/[^\w.-]/g, "_")}.json`);

// Per-session state: consecutive block count, the violation keys already shown as notifications and the keys autofixed before a commit.
function readState(sessionId) {
  try {
    const state = JSON.parse(readFileSync(stateFile(sessionId), "utf8"));
    return { blocks: state.blocks ?? 0, notified: Array.isArray(state.notified) ? state.notified : [], autofixed: Array.isArray(state.autofixed) ? state.autofixed : [] };
  } catch {
    return { blocks: 0, notified: [], autofixed: [] };
  }
}

function writeState(sessionId, state) {
  try {
    if (state.blocks === 0 && state.notified.length === 0 && state.autofixed.length === 0) rmSync(stateFile(sessionId), { force: true });
    else writeFileSync(stateFile(sessionId), JSON.stringify(state));
  } catch {
    // Losing the state only loosens the loop guard and repeats notifications.
  }
}

const baseFile = (sessionId) => join(tmpdir(), `diff-gate-base-${String(sessionId ?? "none").replace(/[^\w.-]/g, "_")}.json`);

// SessionStart hook: records the working tree for the session so the Stop hook diffs against it. Prints nothing; never fails.
// `git stash create` writes a commit of the tracked changes (staged and unstaged) without touching the tree and prints nothing when clean, then HEAD is the base.
function sessionStart() {
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    const root = repoRoot(resolve(input.cwd ?? process.cwd()));
    const head = root === null ? null : resolveRev(root, "HEAD");
    if (head !== null) {
      const stash = git(root, ["stash", "create"])?.trim();
      const base = stash ? (resolveRev(root, stash) ?? head) : head;
      const untracked = Object.fromEntries(untrackedHashes(root));
      writeFileSync(baseFile(input.session_id), JSON.stringify({ base, root, untracked, time: new Date().toISOString() }));
    }
  } catch {
    // No record: the Stop hook then does nothing for this session.
  }
  return 0;
}

// The session record as { base, skipUntracked }, or null when there is none (session started before install, or the recorded base is gone).
// DIFF_GATE_BASE overrides the base and skips no untracked file.
function sessionBase(sessionId, cwd) {
  if (process.env.DIFF_GATE_BASE) return { base: process.env.DIFF_GATE_BASE, skipUntracked: undefined };
  try {
    const { base, root, untracked } = JSON.parse(readFileSync(baseFile(sessionId), "utf8"));
    if (typeof base === "string" && resolveRev(repoRoot(resolve(cwd)) ?? root, base) !== null) {
      return { base, skipUntracked: new Map(Object.entries(untracked ?? {})) };
    }
  } catch {
    // No recorded base.
  }
  return null;
}

// DIFF_GATE_LOG, else <git common dir>/labshelf-logs/diff-gate.jsonl (LABSHELF_LOGS_DIR replaces the folder), the place scripts/agents/run.mjs logs to.
function logFile(cwd) {
  if (process.env.DIFF_GATE_LOG) return process.env.DIFF_GATE_LOG;
  const dir = process.env.LABSHELF_LOGS_DIR || git(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])?.trim();
  if (!dir) return null;
  const folder = process.env.LABSHELF_LOGS_DIR ? dir : join(dir, "labshelf-logs");
  mkdirSync(folder, { recursive: true });
  return join(folder, "diff-gate.jsonl");
}

function logLine(entry, cwd) {
  try {
    const file = logFile(cwd);
    if (file) appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // Logging must never break the hook.
  }
}

async function hook() {
  const started = Date.now();
  let input = {};
  const entry = { time: new Date().toISOString(), event: null, agent_type: null, stop_hook_active: null, violations: {}, decision: "allow" };
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
    entry.event = input.hook_event_name ?? null;
    entry.agent_type = input.agent_type ?? null;
    entry.session_id = input.session_id ?? null;
    entry.stop_hook_active = input.stop_hook_active ?? null;
    const policy = normalizeVariant(process.env.DIFF_GATE_POLICY);
    const session = sessionBase(input.session_id, input.cwd ?? process.cwd());
    if (session === null) {
      entry.decision = "no_session";
      return finishHook(entry, started, input.cwd);
    }
    entry.policy = policy;
    entry.base = session.base;
    const result = await runGate({ repo: input.cwd ?? process.cwd(), base: session.base, skipUntracked: session.skipUntracked });
    const { block, autofix, notify, silent } = applyPolicy(result.violations, policy, { subagent: input.hook_event_name === "SubagentStop" });
    // Autofixes go first; ones that cannot be applied (not a plain declaration) fall back to notifying under f, else to blocking.
    const fixed = autofix.length > 0 ? applyAutofixes(result.root, autofix) : { applied: [], failed: [] };
    const blocking = policy === "f" ? block : [...block, ...fixed.failed];
    const notifying = policy === "f" ? [...notify, ...fixed.failed] : notify;
    if (fixed.applied.length > 0) entry.autofixed = fixed.applied;
    if (silent.length > 0) entry.silent = countByKind(silent);
    entry.violations = countByKind(result.violations);
    entry.changed_files = result.changedFiles;
    entry.timings = result.timings;
    if (result.errors.length > 0) entry.errors = result.errors;
    if (result.skipped.length > 0) entry.skipped = result.skipped;
    const state = readState(input.session_id);
    const seen = new Set(state.notified);
    const fixedBefore = new Set(state.autofixed); // fixed by --pre-commit: never notify about them again
    const fresh = notifying.filter((violation) => !seen.has(violationKey(violation)) && !fixedBefore.has(violationKey(violation)));
    for (const violation of fresh) seen.add(violationKey(violation));
    const output = {};
    if (fresh.length > 0) {
      entry.notified = countByKind(fresh);
      output.systemMessage = formatNotice(fresh);
    }
    let blocks = state.blocks;
    if (blocking.length === 0) {
      blocks = 0;
    } else if (input.stop_hook_active && state.blocks >= MAX_BLOCKS) {
      entry.decision = "allow_capped";
    } else {
      blocks += 1;
      entry.decision = "block";
      output.decision = "block";
      output.reason = formatReason(blocking);
    }
    writeState(input.session_id, { blocks, notified: [...seen], autofixed: state.autofixed });
    if (Object.keys(output).length > 0) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch (error) {
    entry.errors = [`internal: ${String(error?.message ?? error)}`];
  }
  return finishHook(entry, started, input.cwd);
}

function finishHook(entry, started, cwd) {
  entry.duration_ms = Date.now() - started;
  logLine(entry, cwd ?? process.cwd());
  return 0;
}

// PreToolUse hook (matcher Bash): when the command runs `git commit`, applies the autofix actions of the session policy and stages
// exactly the files it edited, so the commit that follows contains them. Prints nothing, never denies, any error ends in exit 0.
async function preCommit() {
  const started = Date.now();
  const entry = { time: new Date().toISOString(), event: "PreToolUse", mode: "pre-commit", decision: "allow" };
  try {
    const input = JSON.parse(readFileSync(0, "utf8") || "{}");
    if (input.tool_name !== undefined && input.tool_name !== "Bash") return 0;
    const commit = detectCommit(input.tool_input?.command, input.cwd ?? process.cwd());
    if (commit === null) return 0;
    const policy = normalizeVariant(process.env.DIFF_GATE_POLICY);
    const session = sessionBase(input.session_id, input.cwd ?? process.cwd());
    if (session === null) return 0;
    entry.policy = policy;
    entry.base = session.base;
    const result = await runGate({ repo: commit.dir, base: session.base, checks: ["knip"], skipUntracked: session.skipUntracked }); // only knip yields autofix actions
    const { autofix } = applyPolicy(result.violations, policy, { subagent: false });
    if (autofix.length === 0) return 0;
    const fixed = applyAutofixes(result.root, autofix);
    entry.autofixed = fixed.applied;
    const files = [...new Set(autofix.filter((v) => fixed.applied.some((a) => a.startsWith(`${v.file}:${v.line}:`))).map((v) => v.file))];
    if (files.length > 0) {
      execFileSync("git", ["add", "--", ...files], { cwd: result.root, stdio: "ignore" });
      entry.staged = files;
    }
    if (fixed.applied.length > 0) {
      const state = readState(input.session_id);
      const keys = autofix.filter((v) => fixed.applied.includes(`${v.file}:${v.line}:${v.symbol}`)).map(violationKey);
      writeState(input.session_id, { ...state, autofixed: [...new Set([...state.autofixed, ...keys])] });
    }
  } catch (error) {
    entry.errors = [`internal: ${String(error?.message ?? error)}`];
  }
  if (entry.autofixed || entry.errors) {
    entry.duration_ms = Date.now() - started;
    logLine(entry, process.cwd());
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (args.sessionStart) process.exit(sessionStart());
  if (args.preCommit) process.exit(await preCommit().catch(() => 0));
  const code = await (args.hook ? hook() : cli(args)).catch(() => (args.hook ? 0 : 2));
  process.exit(code);
}
