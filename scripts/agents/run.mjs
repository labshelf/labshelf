#!/usr/bin/env node
// Runs test, typecheck, build or any command; keeps the full log, prints at most 40 summary lines (cmd: logs of up to 60 lines whole, longer ones cut by a deterministic filter to the error lines, repeats counted, and the last lines), counts spec test attempts and blocks stalled ones.
import { spawnSync } from "node:child_process";
import { constants as osConstants, tmpdir } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emit } from "./telemetry.mjs";

const MAX_LINES = 40;
const MAX_TSC_ERRORS = 20;
const MAX_JEST_FAILURES = 8;
const MAX_RUNS = 5;
const BLOCKED_EXIT = 3;
const LINE_WIDTH = 200;
const CMD_SHORT_LOG = 60;
const CMD_BODY = MAX_LINES - 2;
const CMD_FINAL = 8;
const TOOLING_GLOBS = ["scripts/*/__tests__/*.test.mjs", "tools/*/__tests__/*.test.mjs", ".claude/hooks/__tests__/*.test.mjs"];
const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const USAGE = `usage:
  node scripts/agents/run.mjs test <pkg|tooling> [--spec <id> --plan <slug>] -- <paths/args>
  node scripts/agents/run.mjs typecheck <pkg>
  node scripts/agents/run.mjs build <pkg>
  node scripts/agents/run.mjs cmd -- <command> [args]
<pkg> is a folder under packages/. 'tooling' runs node --test (default: the test:tooling globs).
Prints at most ${MAX_LINES} lines and the log path; the exit code is the command's. With --spec, attempts are counted: a stalled or fifth attempt prints BLOCKED and exits ${BLOCKED_EXIT}.
State: LABSHELF_LOGS_DIR (default .git/labshelf-logs), LABSHELF_RUNS_DIR (default .git/labshelf-runs).`;

const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (text) => String(text).replace(ANSI, "");
const clip = (text, width = LINE_WIDTH) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);
const splitLines = (text) => stripAnsi(text).split(/\r?\n/);
const rel = (root, file) => (isAbsolute(file) ? relative(root, file) || file : file);

// ---- summaries ------------------------------------------------------------------------------------------------

const isNoiseFrame = (frame) => /node_modules|node:|\.test\.|__tests__/.test(frame);

function firstFrame(message, root) {
  for (const line of splitLines(message)) {
    const match = line.match(/^\s*at\s+(?:.*?\()?([^()\s]+:\d+:\d+)\)?\s*$/);
    if (match && !isNoiseFrame(match[1])) {
      const [, location] = match;
      const at = location.match(/^(.*?)(:\d+:\d+)$/);
      return `${rel(root, at[1])}${at[2]}`;
    }
  }
  return null;
}

/** Failing test ids of a jest --json result: `<file> > <full name>`, or the file for a suite that failed to run. */
export function failingJest(json, { root }) {
  const failing = [];
  for (const suite of json?.testResults ?? []) {
    const file = rel(root, suite.name ?? "");
    const failed = (suite.assertionResults ?? []).filter((t) => t.status === "failed");
    if (failed.length) for (const t of failed) failing.push(`${file} > ${t.fullName ?? t.title}`);
    else if (suite.status === "failed") failing.push(file);
  }
  return failing;
}

/** Summary lines of a jest --json result: failing names, expected/received and the first frame outside node_modules and tests. */
export function summarizeJest(json, { root }) {
  const lines = [`jest: ${json.numFailedTests ?? 0} failed, ${json.numTotalTests ?? 0} total`];
  const entries = [];
  for (const suite of json.testResults ?? []) {
    const file = rel(root, suite.name ?? "");
    const failed = (suite.assertionResults ?? []).filter((t) => t.status === "failed");
    for (const t of failed) entries.push({ title: `FAIL ${file} > ${t.fullName ?? t.title}`, message: (t.failureMessages ?? []).join("\n") });
    if (!failed.length && suite.status === "failed") entries.push({ title: `FAIL ${file} (suite failed to run)`, message: suite.message ?? "" });
  }
  for (const entry of entries.slice(0, MAX_JEST_FAILURES)) {
    lines.push(clip(entry.title));
    const text = splitLines(entry.message);
    const expected = text.find((l) => /^\s*Expected\b/.test(l));
    const received = text.find((l) => /^\s*Received\b/.test(l));
    if (expected || received) {
      if (expected) lines.push(clip(`  ${expected.trim()}`));
      if (received) lines.push(clip(`  ${received.trim()}`));
    } else {
      const first = text.find((l) => l.trim() && !/^\s*at\s/.test(l));
      if (first) lines.push(clip(`  ${first.trim()}`));
    }
    const frame = firstFrame(entry.message, root);
    if (frame) lines.push(`  at ${frame}`);
  }
  if (entries.length > MAX_JEST_FAILURES) lines.push(`… ${entries.length - MAX_JEST_FAILURES} more failing tests in the log`);
  return lines;
}

/** Summary lines of tsc output: `file(l,c): error TSxxxx` grouped by file, at most 20 errors. */
export function summarizeTsc(text) {
  const errors = [];
  for (const line of splitLines(text)) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\): error (TS\d+): (.*)$/);
    if (match) errors.push({ file: match[1], at: `${match[2]},${match[3]}`, code: match[4], message: match[5] });
  }
  if (!errors.length) return ["tsc: no errors found in the output"];
  const shown = errors.slice(0, MAX_TSC_ERRORS);
  const groups = new Map();
  for (const error of shown) groups.set(error.file, [...(groups.get(error.file) ?? []), error]);
  const lines = [`tsc: ${errors.length} errors in ${new Set(errors.map((e) => e.file)).size} files`];
  for (const [file, list] of groups) {
    lines.push(file);
    for (const e of list) lines.push(clip(`  ${e.at} ${e.code} ${e.message}`));
  }
  if (errors.length > shown.length) lines.push(`… ${errors.length - shown.length} more errors in the log`);
  return lines;
}

/** Summary of node --test TAP output: totals, failing test names and the first error line of each. */
export function summarizeNodeTest(text) {
  const all = splitLines(text);
  const total = (key) => Number(all.find((l) => new RegExp(`^# ${key} \\d+`).test(l))?.split(" ")[2] ?? 0);
  const failures = [];
  for (let i = 0; i < all.length; i += 1) {
    const match = all[i].match(/^\s*not ok \d+ - (.*)$/);
    if (!match) continue;
    const entry = { name: match[1], error: "", aggregate: false };
    for (let j = i + 1; j < all.length && !/^\s*(not )?ok \d+ - /.test(all[j]) && !/^\s*# Subtest/.test(all[j]); j += 1) {
      if (/failureType: 'subtestsFailed'/.test(all[j])) entry.aggregate = true;
      const error = all[j].match(/^\s*error: (.*)$/);
      if (error && !entry.error) {
        const inline = error[1].replace(/^'|'$/g, "");
        entry.error = /^[|>][+-]?$/.test(inline) ? (all[j + 1] ?? "").trim() : inline;
      }
    }
    failures.push(entry);
  }
  const leaves = failures.filter((f) => !f.aggregate);
  const lines = [`node --test: ${total("tests")} tests, ${total("pass")} passed, ${total("fail")} failed`];
  for (const failure of leaves.slice(0, 12)) {
    lines.push(clip(`FAIL ${failure.name}`));
    if (failure.error) lines.push(clip(`  ${failure.error}`));
  }
  if (leaves.length > 12) lines.push(`… ${leaves.length - 12} more failing tests in the log`);
  return { lines, failing: leaves.map((f) => f.name) };
}

/** Per-test status of a jest --json result: `{name, ok, message}`; a suite that failed to run (compile or import error) is one failing entry named by its file. */
export function parseJest(json, { root }) {
  const tests = [];
  for (const suite of json?.testResults ?? []) {
    const file = rel(root, suite.name ?? "");
    const results = suite.assertionResults ?? [];
    for (const t of results) tests.push({ name: `${file} > ${t.fullName ?? t.title}`, ok: t.status === "passed", message: stripAnsi((t.failureMessages ?? []).join("\n")) });
    if (!results.length && suite.status === "failed") tests.push({ name: file, ok: false, message: stripAnsi(suite.message ?? "") });
  }
  return tests;
}

/** Per-test status of node --test TAP output: `{name, ok, message}` for every leaf test (suites that only group tests are left out); a file that fails to load is one failing entry. */
export function parseTap(text) {
  const all = splitLines(text);
  const indentOf = (line) => line.length - line.trimStart().length;
  const results = [];
  for (let i = 0; i < all.length; i += 1) {
    const match = all[i].match(/^(\s*)(not )?ok \d+ - (.*)$/);
    if (match) results.push({ line: i, indent: match[1].length, ok: !match[2], name: match[3] });
  }
  const tests = [];
  results.forEach((result, n) => {
    const next = results[n + 1];
    const end = next ? next.line : all.length;
    const previous = results.slice(0, n).reverse().find((r) => r.indent <= result.indent);
    const from = previous ? previous.line + 1 : 0;
    const isSuite = results.some((r) => r.line >= from && r.line < result.line && r.indent > result.indent);
    if (isSuite) return;
    const block = all.slice(result.line + 1, end).filter((l) => l.trim() && !/^\s*# Subtest/.test(l) && indentOf(l) > result.indent);
    tests.push({ name: result.name, ok: result.ok, message: result.ok ? "" : block.join("\n").trim() });
  });
  return tests;
}

function summarizeTail(text, count = 30) {
  const lines = splitLines(text).filter((l) => l.trim());
  return lines.length > count ? [`… ${lines.length - count} earlier lines in the log`, ...lines.slice(-count).map((l) => clip(l))] : lines.map((l) => clip(l));
}

const ERROR_LINE = [
  /error TS\d+/,
  /^\s*●/,
  /^\s*FAIL\b/,
  /^\s*(Expected|Received)\b|\bexpect\(/,
  /^\s*not ok\b/,
  /^\s+\d+:\d+\s+error\s/,
  /^\s*✖\s+\d+ problems?/,
  /\bError:|\*\*\* Error|\bERR!/,
  /^\s*(error|ERROR|fatal|FATAL)\b[:\s[]/,
];
const ESLINT_PROBLEM = /^\s+\d+:\d+\s+error\s/;
const ESLINT_FILE = /^(?:\/|\.{0,2}\/|[A-Za-z]:\\)?[^\s:]+\.\w+$/;

/** True for a stack frame that points to a file outside node_modules and node internals. */
const isRepoFrame = (line) => {
  const match = line.match(/^\s*at\s+(?:.*?\()?([^()\s]+:\d+:\d+)\)?\s*$/);
  return Boolean(match) && !/node_modules|node:/.test(match[1]);
};

/** Body lines for a `cmd` log: whole up to 60 lines; longer ones keep the error lines (tsc, jest, node:test, eslint, `Error:`, repo stack frames) once each with a repeat count, then the last 8 lines, at most 38 lines. */
export function summarizeCmd(text) {
  const lines = splitLines(text);
  while (lines.length && !lines.at(-1).trim()) lines.pop();
  if (lines.length <= CMD_SHORT_LOG) return lines.map((l) => clip(l));

  const kept = new Map();
  let matches = 0;
  let eslintFile = null;
  const keep = (line) => {
    const key = line.trim();
    kept.set(key, { line, count: (kept.get(key)?.count ?? 0) + 1 });
  };
  for (const line of lines) {
    if (ESLINT_FILE.test(line)) eslintFile = line;
    if (!ERROR_LINE.some((re) => re.test(line)) && !isRepoFrame(line)) continue;
    matches += 1;
    if (ESLINT_PROBLEM.test(line) && eslintFile && !kept.has(eslintFile.trim())) keep(eslintFile);
    keep(line);
  }
  const final = lines.filter((l) => l.trim()).slice(-CMD_FINAL);
  const finalKeys = new Set(final.map((l) => l.trim()));
  const entries = [...kept.entries()].filter(([key, entry]) => !(finalKeys.has(key) && entry.count === 1));
  const budget = CMD_BODY - final.length - 3;
  const shown = entries.length > budget ? entries.slice(0, budget - 1) : entries;
  const body = [`(${lines.length} lines filtered: ${matches} error lines, ${kept.size} distinct; full log below)`];
  for (const [, { line, count }] of shown) body.push(clip(count > 1 ? `${line} (x${count})` : line));
  if (shown.length < entries.length) body.push(`… ${entries.length - shown.length} more distinct error lines in the log`);
  if (!matches) body.push("(no error lines recognised)");
  body.push(`(last ${final.length} lines)`, ...final.map((l) => clip(l)));
  return body;
}

// ---- progress -------------------------------------------------------------------------------------------------

/** Why the next run of a spec is refused: `max_runs` at five runs, `no_progress` when the last two runs did not shrink the failing set. */
export function blockReason(runs) {
  if (runs.length >= MAX_RUNS) return "max_runs";
  if (runs.length >= 3) {
    const [a, b, c] = runs.slice(-3).map((r) => r.failing.length);
    if (b >= a && c >= b) return "no_progress";
  }
  return null;
}

const safeId = (text) => String(text).replace(/[^\w.-]/g, "_");

function gitDir(root) {
  const run = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const out = run.status === 0 ? run.stdout.trim() : "";
  return out ? resolve(root, out) : join(root, ".git");
}

function loadRuns(file) {
  try {
    const runs = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

// ---- argument parsing -----------------------------------------------------------------------------------------

function parseArgv(argv) {
  const dash = argv.indexOf("--");
  const head = dash === -1 ? argv : argv.slice(0, dash);
  const rest = dash === -1 ? [] : argv.slice(dash + 1);
  const parsed = { kind: head[0], pkg: undefined, spec: undefined, plan: process.env.LABSHELF_PLAN || undefined, rest };
  const positional = [];
  for (let i = 1; i < head.length; i += 1) {
    if (head[i] === "--spec") parsed.spec = head[++i];
    else if (head[i] === "--plan") parsed.plan = head[++i];
    else positional.push(head[i]);
  }
  if (parsed.kind !== "cmd") [parsed.pkg] = positional;
  parsed.extra = parsed.kind === "cmd" ? positional : positional.slice(1);
  return parsed;
}

function validate(parsed, root) {
  if (!["test", "typecheck", "build", "cmd"].includes(parsed.kind ?? "")) return `unknown kind '${parsed.kind ?? ""}'`;
  if (parsed.extra.length) return `unexpected arguments before '--': ${parsed.extra.join(" ")}`;
  if (parsed.kind === "cmd") return parsed.rest.length ? null : "cmd needs a command after '--'";
  if (!parsed.pkg) return `${parsed.kind} needs a package`;
  const tooling = parsed.kind === "test" && parsed.pkg === "tooling";
  if (!tooling && !existsSync(join(root, "packages", parsed.pkg, "package.json"))) return `unknown package '${parsed.pkg}' (a folder under packages/)`;
  if (parsed.spec && parsed.kind !== "test") return "--spec only applies to test";
  if (parsed.spec && !parsed.plan) return "--spec needs --plan <slug> (or LABSHELF_PLAN)";
  return null;
}

// ---- running --------------------------------------------------------------------------------------------------

function defaultSpawn(command, args, options) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 30, ...options });
}

function exitCodeOf(result) {
  if (result.error) return 127;
  if (typeof result.status === "number") return result.status;
  return 128 + (osConstants.signals[result.signal] ?? 1);
}

function writeLog(dir, kind, content) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (let n = 0; ; n += 1) {
    const file = join(dir, `${stamp}${n ? `-${n}` : ""}-${kind}.log`);
    if (existsSync(file)) continue;
    writeFileSync(file, content);
    return file;
  }
}

/** Runs one wrapper invocation and returns the exit code. `deps`: `root`, `spawn(command, args, options)`, `out(line)`. */
export async function main(argv, deps = {}) {
  const root = deps.root ?? DEFAULT_ROOT;
  const out = deps.out ?? ((line) => process.stdout.write(`${line}\n`));
  const spawn = deps.spawn ?? defaultSpawn;
  const parsed = parseArgv(argv);
  const problem = argv.length === 0 ? "no arguments" : validate(parsed, root);
  if (problem) {
    out(`run.mjs: ${problem}`);
    for (const line of USAGE.split("\n")) out(line);
    return 2;
  }

  const stateFile = parsed.spec ? join(process.env.LABSHELF_RUNS_DIR || join(gitDir(root), "labshelf-runs"), safeId(parsed.plan), `${safeId(parsed.spec)}.json`) : null;
  const runs = stateFile ? loadRuns(stateFile) : [];
  const reason = stateFile ? blockReason(runs) : null;
  if (reason) {
    emit("test_blocked", { plan: parsed.plan, spec: parsed.spec, attempt: runs.length, reason });
    out(`BLOCKED: return report status blocked_tests (${reason === "max_runs" ? `${runs.length} test runs used for ${parsed.spec}` : `the last two runs of ${parsed.spec} did not shrink the failing set`})`);
    return BLOCKED_EXIT;
  }

  const tooling = parsed.kind === "test" && parsed.pkg === "tooling";
  const jest = parsed.kind === "test" && !tooling;
  const scratch = jest ? mkdtempSync(join(tmpdir(), "labshelf-run-")) : null;
  const jsonFile = scratch ? join(scratch, "jest.json") : null;
  let command = "pnpm";
  let args;
  if (parsed.kind === "cmd") [command, ...args] = parsed.rest;
  else if (tooling) [command, args] = [process.execPath, ["--test", "--test-reporter=tap", ...(parsed.rest.length ? parsed.rest : TOOLING_GLOBS)]];
  else if (jest) args = ["--filter", `@labshelf/${parsed.pkg}`, "test", "--json", `--outputFile=${jsonFile}`, ...parsed.rest];
  else args = ["--filter", `@labshelf/${parsed.pkg}`, parsed.kind, ...parsed.rest];

  const result = spawn(command, args, { cwd: root, env: { ...process.env, FORCE_COLOR: "0" } });
  const code = exitCodeOf(result);
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}${result.error ? `\n${result.error.message}\n` : ""}`;
  const logFile = writeLog(process.env.LABSHELF_LOGS_DIR || join(gitDir(root), "labshelf-logs"), parsed.kind, `$ ${[command, ...args].join(" ")}\n${output}`);

  let body;
  let failing = [];
  if (jest) {
    let json = null;
    try {
      json = JSON.parse(readFileSync(jsonFile, "utf8"));
    } catch {
      /* jest crashed before writing the result */
    }
    rmSync(scratch, { recursive: true, force: true });
    if (json) {
      body = summarizeJest(json, { root });
      failing = failingJest(json, { root });
    } else body = summarizeTail(output);
  } else if (tooling) {
    ({ lines: body, failing } = summarizeNodeTest(output));
  } else if (parsed.kind === "typecheck") body = code === 0 ? ["tsc: no errors"] : summarizeTsc(output);
  else if (parsed.kind === "build") body = code === 0 ? ["build ok"] : /error TS\d+/.test(output) ? summarizeTsc(output) : summarizeTail(output);
  else body = summarizeCmd(output);

  const label = parsed.kind === "cmd" ? `cmd ${parsed.rest[0]}` : `${parsed.kind} ${parsed.pkg}`;
  const lines = [`[${label}] exit ${code}`, ...body];
  const kept = parsed.kind !== "cmd" && lines.length > MAX_LINES - 1 ? [...lines.slice(0, MAX_LINES - 2), `… ${lines.length - (MAX_LINES - 2)} more lines in the log`] : lines;
  for (const line of kept) out(line);
  out(`log: ${logFile}`);

  if (stateFile) {
    if (code !== 0 && !failing.length) failing = ["(run failed)"];
    runs.push({ ts: new Date().toISOString(), failing, exit: code });
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify(runs, null, 2)}\n`);
    emit("test_run", { plan: parsed.plan, spec: parsed.spec, failing: failing.length, attempt: runs.length, exit: code });
  }
  return code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  process.exitCode = argv.includes("--help") || argv.includes("-h") ? (console.log(USAGE), 0) : await main(argv);
}
