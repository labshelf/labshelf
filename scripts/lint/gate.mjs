// Runs typecheck, tests and lint for the packages a change touches, then the module rules once, and prints only PASS/FAIL with the errors that matter.
// Usage: pnpm gate [--full] [--no-lint] [pkg...] — with no packages, gates those touched by the uncommitted change (core
// pulls in every app). By default tests run only where the change reaches (jest --findRelatedTests on the changed files)
// and ESLint only on the changed files, with a cache; --full runs every test and the packages' whole lint scripts.
// --no-lint runs only typecheck and tests, and skips the module rules.
// The result is recorded per working tree in .git/labshelf-gate (gateRecord.mjs): a second run on the same tree, or
// `plan close` after it, returns at once when a PASS at least as strong covered the same packages.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gatePassed, touchedPackages, treeState, writeGateRecord } from "./gateRecord.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STEPS = ["typecheck", "test", "lint"];
const MAX_ERRORS = 15;
const ERROR_LINE = /error|\u25CF|\u2715|FAIL\b/;
const NOISE = /^(\[?ELIFECYCLE|Error: ERR_PNPM|Found \d+ errors? in|\u25CF Test suite failed to run)/;
const LOCATED = /\.\w+:\d+/;
const ANSI = /\x1b\[[0-9;]*m/g;

const SOURCE = /\.(ts|tsx|js|mjs|cjs)$/;
const LINTED = /\.(ts|tsx)$/;

/** Changed files that still exist, as absolute paths: the uncommitted change, untracked files included. */
function changedFiles() {
  const out = spawnSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).stdout;
  return out
    .split("\n")
    .filter((line) => line && !line.startsWith(" D") && !line.startsWith("D "))
    .map((line) => line.slice(3).replace(/^.* -> /, ""))
    .filter((path) => existsSync(join(root, path)))
    .map((path) => join(root, path));
}

/** The pnpm arguments of one step: whole package with --full, else only what the changed files reach. */
function stepArgs(pkg, step, changed) {
  if (full || step === "typecheck") return ["--filter", `@labshelf/${pkg}`, step];
  const own = (path) => path.startsWith(join(root, "packages", pkg) + "/");
  if (step === "test") {
    // A core change reaches the apps' tests too: their jest roots include core's src.
    const reach = changed.filter((path) => SOURCE.test(path) && (own(path) || path.startsWith(join(root, "packages", "core") + "/")));
    return reach.length ? ["--filter", `@labshelf/${pkg}`, step, "--findRelatedTests", ...reach, "--passWithNoTests"] : null;
  }
  const files = changed.filter((path) => own(path) && LINTED.test(path));
  return files.length ? ["exec", "eslint", "--cache", "--cache-location", "node_modules/.cache/eslint/", ...files] : null;
}

function runStep(pkg, step, changed) {
  const scripts = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8")).scripts ?? {};
  if (!scripts[step]) return { status: "n/a", errors: [] };
  const args = stepArgs(pkg, step, changed);
  if (!args) return { status: "PASS (nothing changed)", errors: [] };
  const run = spawnSync("pnpm", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, FORCE_COLOR: "0" } });
  const output = `${run.stdout}\n${run.stderr}`.replace(ANSI, "");
  const summary = step === "test" ? output.match(/^Tests:.*$/m)?.[0].replace(/^Tests:\s*/, "") : undefined;
  if (run.status === 0) return { status: summary ? `PASS (${summary})` : "PASS", errors: [] };
  const errors = output.split("\n").map((line) => line.trim()).filter((line) => ERROR_LINE.test(line) && !NOISE.test(line));
  return { status: summary ? `FAIL (${summary})` : "FAIL", errors: [...new Set(errors)].map((line) => `${pkg} ${step}: ${line}`) };
}

const args = process.argv.slice(2);
const noLint = args.includes("--no-lint");
const full = args.includes("--full");
const named = args.filter((arg) => !arg.startsWith("--"));
const steps = noLint ? STEPS.filter((step) => step !== "lint") : STEPS;
const packages = named.length ? named : touchedPackages(root);
const { fingerprint } = treeState(root);
if (packages.length === 0) {
  writeGateRecord(root, { fingerprint, passed: true, lint: !noLint, packages });
  console.log("Gate: PASS (no package changed)");
  process.exit(0);
}
if (gatePassed(root, { fingerprint, lint: !noLint, packages })) {
  console.log(`Gate: PASS (cached ${fingerprint}: ${packages.join(", ")})`);
  process.exit(0);
}

const lines = [];
const errors = [];
const changed = full ? [] : changedFiles();
for (const pkg of packages) {
  const results = steps.map((step) => [step, runStep(pkg, step, changed)]);
  lines.push(`${pkg}: ${results.map(([step, result]) => `${step} ${result.status}`).join(" · ")}`);
  for (const [, result] of results) errors.push(...result.errors);
}
// The module rules span every package, so they run once for the whole tree.
const modules = noLint ? null : spawnSync("node", [join(root, "scripts", "lint", "modules.mjs")], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
if (modules) lines.push(`modules: ${modules.status === 0 ? "PASS" : "FAIL"}`);
if (modules && modules.status !== 0) {
  const problems = `${modules.stderr}`.split("\n").filter((line) => line && !line.startsWith("warning "));
  errors.push(...(problems.length > 0 ? problems : [modules.stdout.trim() || "modules.mjs crashed"]).map((line) => `modules: ${line}`));
}

const passed = errors.length === 0 && !lines.some((line) => line.includes("FAIL"));
console.log(`Gate: ${passed ? "PASS" : "FAIL"}`);
console.log(lines.join("\n"));
if (!passed) {
  console.log(`Errors (${Math.min(errors.length, MAX_ERRORS)} of ${errors.length}):`);
  // Errors that name a file and line come before suite-level lines such as "FAIL <test file>".
  errors.sort((a, b) => Number(LOCATED.test(b)) - Number(LOCATED.test(a)));
  console.log(errors.slice(0, MAX_ERRORS).map((line) => `- ${line}`).join("\n"));
}
writeGateRecord(root, { fingerprint, passed, lint: !noLint, packages });
process.exit(passed ? 0 : 1);
