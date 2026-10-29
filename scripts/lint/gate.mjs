// Runs typecheck, tests and lint for the packages a change touches, then the module rules once, and prints only PASS/FAIL with the errors that matter.
// Usage: pnpm gate [--no-lint] [pkg...] — with no packages, gates those touched by the uncommitted change (core pulls in
// every app). --no-lint runs only typecheck and tests, and skips the module rules.
// The result is recorded per working tree in .git/labshelf-gate (gateRecord.mjs): a second run on the same tree, or
// `plan close` after it, returns at once when a PASS at least as strong covered the same packages.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
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

function runStep(pkg, step) {
  const scripts = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8")).scripts ?? {};
  if (!scripts[step]) return { status: "n/a", errors: [] };
  const run = spawnSync("pnpm", ["--filter", `@labshelf/${pkg}`, step], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30, env: { ...process.env, FORCE_COLOR: "0" } });
  const output = `${run.stdout}\n${run.stderr}`.replace(ANSI, "");
  const summary = step === "test" ? output.match(/^Tests:.*$/m)?.[0].replace(/^Tests:\s*/, "") : undefined;
  if (run.status === 0) return { status: summary ? `PASS (${summary})` : "PASS", errors: [] };
  const errors = output.split("\n").map((line) => line.trim()).filter((line) => ERROR_LINE.test(line) && !NOISE.test(line));
  return { status: summary ? `FAIL (${summary})` : "FAIL", errors: [...new Set(errors)].map((line) => `${pkg} ${step}: ${line}`) };
}

const args = process.argv.slice(2);
const noLint = args.includes("--no-lint");
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
for (const pkg of packages) {
  const results = steps.map((step) => [step, runStep(pkg, step)]);
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
