// `plan red <session> <id>` (D7): puts the stubs and hidden tests in the working tree, runs the spec's test command, checks that every test
// fails with `not implemented`, then restores every touched file. `plan red --restore` undoes a crashed run from `.git/labshelf-red.json`.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { main as runMain, parseJest, parseTap } from "../agents/run.mjs";
import { findSpec } from "./planFiles.mjs";
import { seamPaths, writeStubs } from "./planStubs.mjs";
import { hiddenTargets } from "./planTests.mjs";

const NOT_IMPLEMENTED = /not implemented/i;

function gitDir(root) {
  const run = spawnSync("git", ["rev-parse", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const out = run.status === 0 ? run.stdout.trim() : "";
  return out ? resolve(root, out) : join(root, ".git");
}

export const redRecordPath = (root) => process.env.LABSHELF_RED_FILE || join(gitDir(root), "labshelf-red.json");

/** Parts of the test command for run.mjs, without `--spec` and `--plan` so the run is not counted. */
function runArgv(command) {
  const tokens = command.trim().split(/\s+/);
  if (tokens[0] !== "node" || !/run\.mjs$/.test(tokens[1] ?? "") || tokens[2] !== "test") throw new Error(`plan red: tests.command must be "node scripts/agents/run.mjs test …", got "${command}"`);
  const argv = [];
  for (let i = 2; i < tokens.length; i += 1) {
    if (tokens[i] === "--spec" || tokens[i] === "--plan") i += 1;
    else argv.push(tokens[i]);
  }
  return argv;
}

/**
 * Records every path red will touch (original content, or absence) in the record file, then writes the stubs and copies the hidden tests in place.
 * Returns the spec's test argv. Throws without touching anything when a record already exists or a hidden test is missing.
 */
export function prepareRed(root, spec) {
  const record = redRecordPath(root);
  if (existsSync(record)) throw new Error(`plan red: ${record} exists; run plan red --restore first`);
  if (!spec.tests?.command) throw new Error(`spec ${spec.id} has no tests.command`);
  const argv = runArgv(spec.tests.command);
  const targets = hiddenTargets(spec);
  for (const { from } of targets) if (!existsSync(join(root, from))) throw new Error(`plan red: hidden test ${from} does not exist`);
  const paths = [...new Set([...seamPaths(spec), ...targets.map((t) => t.to)])];
  const dirs = new Set();
  for (const path of paths) for (let dir = dirname(join(root, path)); !existsSync(dir); dir = dirname(dir)) dirs.add(dir);
  const files = paths.map((path) => ({ path, original: existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null }));
  mkdirSync(dirname(record), { recursive: true });
  writeFileSync(record, `${JSON.stringify({ spec: spec.id, root, files, createdDirs: [...dirs] }, null, 2)}\n`);
  writeStubs(root, spec);
  for (const { from, to } of targets) {
    mkdirSync(dirname(join(root, to)), { recursive: true });
    copyFileSync(join(root, from), join(root, to));
  }
  return argv;
}

/** Restores every recorded path and deletes the record; returns the restored paths ([] when there is no record). */
export function restoreRed(root) {
  const record = redRecordPath(root);
  if (!existsSync(record)) return [];
  const { files, createdDirs = [] } = JSON.parse(readFileSync(record, "utf8"));
  for (const { path, original } of files) {
    if (original === null) rmSync(join(root, path), { force: true });
    else writeFileSync(join(root, path), original);
  }
  for (const dir of [...createdDirs].sort((a, b) => b.length - a.length)) {
    if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
  }
  rmSync(record, { force: true });
  return files.map((f) => f.path);
}

// Runs run.mjs in process and captures the raw output (and the jest json) its summary would hide.
function runCaptured(root, argv) {
  const captured = { output: "", json: null };
  const spawn = (command, args, options) => {
    const env = { ...options.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 30, ...options, env });
    captured.output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const outputFile = args.find((a) => a.startsWith("--outputFile="));
    if (outputFile) {
      try {
        captured.json = JSON.parse(readFileSync(outputFile.slice("--outputFile=".length), "utf8"));
      } catch {
        /* jest crashed before writing the result */
      }
    }
    return result;
  };
  const lines = [];
  const code = runMain(argv, { root, spawn, out: (line) => lines.push(line) });
  return { ...captured, code, summary: lines };
}

/** Judges parsed tests: every one must have failed with `not implemented`. Returns the offending test descriptions. */
export function redProblems(tests) {
  if (tests.length === 0) return ["no tests were reported (compile, import or syntax error, or no test matched)"];
  return tests.flatMap((t) => {
    if (t.ok) return [`passes: ${t.name}`];
    return NOT_IMPLEMENTED.test(t.message) ? [] : [`fails without "not implemented": ${t.name}`];
  });
}

/** Runs red for a spec; returns `{ ok, problems, total }` and always restores the tree. */
export function planRed(root, { planDir, sessionId, specId }) {
  const spec = findSpec(planDir, sessionId, specId);
  const argv = prepareRed(root, spec);
  try {
    const run = runCaptured(root, argv);
    const tests = argv[1] === "tooling" ? parseTap(run.output) : run.json ? parseJest(run.json, { root }) : [];
    const problems = redProblems(tests);
    if (problems.length > 0 && tests.length === 0) problems.push(...run.summary.slice(0, 10));
    return { ok: problems.length === 0, problems, total: tests.length };
  } finally {
    restoreRed(root);
  }
}
