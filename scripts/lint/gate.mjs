// Runs typecheck, tests and lint for the packages a change touches, then the module rules once, and prints only PASS/FAIL with the errors that matter.
// Usage: pnpm gate [pkg...] — with no packages, gates those touched by the uncommitted change (core pulls in every app).
// A PASS is cached per working tree in .git/labshelf-gate, so a second run on the same tree returns at once.
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const STEPS = ["typecheck", "test", "lint"];
const MAX_ERRORS = 15;
const ERROR_LINE = /error|\u25CF|\u2715|FAIL\b/;
const NOISE = /^(\[?ELIFECYCLE|Error: ERR_PNPM|Found \d+ errors? in|\u25CF Test suite failed to run)/;
const LOCATED = /\.\w+:\d+/;
const ANSI = /\x1b\[[0-9;]*m/g;

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "buffer", maxBuffer: 1 << 30 });

function touchedPackages() {
  const changed = new Set();
  for (const line of git("status", "--porcelain").toString().split("\n")) {
    const match = line.slice(3).match(/^packages\/([^/]+)\//);
    if (match) changed.add(match[1]);
  }
  if (changed.has("core")) for (const app of ["vscode", "browser", "terminal"]) changed.add(app);
  return [...changed].filter((pkg) => existsSync(join(root, "packages", pkg, "package.json"))).sort();
}

function treeFingerprint() {
  const hash = createHash("sha1").update(git("rev-parse", "HEAD")).update(git("diff", "HEAD", "--binary"));
  for (const file of git("ls-files", "--others", "--exclude-standard", "-z").toString().split("\0").filter(Boolean)) {
    hash.update(file).update(readFileSync(join(root, file)));
  }
  return hash.digest("hex").slice(0, 12);
}

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

const packages = process.argv.slice(2).length ? process.argv.slice(2) : touchedPackages();
if (packages.length === 0) {
  console.log("Gate: PASS (no package changed)");
  process.exit(0);
}

const cacheFile = join(git("rev-parse", "--absolute-git-dir").toString().trim(), "labshelf-gate");
const fingerprint = treeFingerprint();
const cached = existsSync(cacheFile) ? readFileSync(cacheFile, "utf8").trim().split(" ") : [];
if (cached[0] === fingerprint && cached[1] === "PASS" && packages.every((pkg) => cached.slice(2).includes(pkg))) {
  console.log(`Gate: PASS (cached ${fingerprint}: ${packages.join(", ")})`);
  process.exit(0);
}

const lines = [];
const errors = [];
for (const pkg of packages) {
  const results = STEPS.map((step) => [step, runStep(pkg, step)]);
  lines.push(`${pkg}: ${results.map(([step, result]) => `${step} ${result.status}`).join(" · ")}`);
  for (const [, result] of results) errors.push(...result.errors);
}
// The module rules span every package, so they run once for the whole tree.
const modules = spawnSync("node", [join(root, "scripts", "lint", "modules.mjs")], { cwd: root, encoding: "utf8", maxBuffer: 1 << 30 });
lines.push(`modules: ${modules.status === 0 ? "PASS" : "FAIL"}`);
if (modules.status !== 0) {
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
writeFileSync(cacheFile, `${fingerprint} ${passed ? "PASS" : "FAIL"} ${packages.join(" ")}\n`);
process.exit(passed ? 0 : 1);
