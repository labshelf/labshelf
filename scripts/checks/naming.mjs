// Checks folder, file and export names against scripts/checks/vocabulary.yaml; run on changed files, given files or --all for a summary.
// Usage: node scripts/checks/naming.mjs [--all [--verbose]] [file...] — exits 1 on any violation and, with --all, on any stale `allow` entry.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseExports } from "./namingExports.mjs";
import { checkExportName, checkPath, loadVocabulary } from "./namingRules.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = /^packages\/[^/]+\/src\/.+\.tsx?$/;
const TOP_WORDS = 30;

const isChecked = (rel) => SOURCE.test(rel) && !/\.d\.ts$/.test(rel) && basename(rel) !== "index.ts" && !/\.test\.tsx?$/.test(rel) && !rel.includes("/__tests__/");

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

const changedFiles = () => [...new Set([...git("diff", "--name-only", "HEAD"), ...git("ls-files", "--others", "--exclude-standard")])].filter((rel) => existsSync(join(root, rel)));

function allFiles(dir = join(root, "packages"), out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) allFiles(path, out);
    else out.push(relative(root, path));
  }
  return out;
}

export function checkFile(index, rel, text, used = null) {
  const exported = parseExports(text, rel);
  const file = basename(rel).replace(/\.[^.]+$/, "");
  const classFile = exported.some((item) => item.kind === "class" && item.name === file);
  return [...checkPath(index, rel, { classFile }), ...exported.flatMap((item) => checkExportName(index, item.name, item.kind, rel, used))];
}

// An `allow` entry is stale when no export it exempts would be reported without it: it only means something while the whole tree is checked.
export const staleAllowEntries = (index, used) => index.allow.filter((item) => !used.has(item));

function printSummary(results) {
  const byRule = new Map();
  const words = new Map();
  for (const violation of results.flatMap((result) => result.violations)) {
    byRule.set(violation.rule, (byRule.get(violation.rule) ?? 0) + 1);
    for (const word of violation.words ?? []) words.set(word, (words.get(word) ?? 0) + 1);
  }
  const clean = results.filter((result) => result.violations.length === 0).length;
  console.log(`SUMMARY: ${results.length} files, ${clean} clean (${((clean / results.length) * 100).toFixed(1)}%)`);
  console.log("violations per rule:");
  for (const [rule, count] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${rule}: ${count}`);
  console.log(`top ${TOP_WORDS} offending words:`);
  for (const [word, count] of [...words].sort((a, b) => b[1] - a[1]).slice(0, TOP_WORDS)) console.log(`  ${word}: ${count}`);
}

function main(args) {
  const flags = new Set(args.filter((arg) => arg.startsWith("--")));
  const given = args.filter((arg) => !arg.startsWith("--")).map((file) => relative(root, resolve(file)));
  const candidates = flags.has("--all") ? allFiles() : given.length > 0 ? given : changedFiles();
  const index = loadVocabulary(join(root, "scripts/checks/vocabulary.yaml"));
  const used = new Set();
  const results = candidates.filter(isChecked).map((rel) => ({ rel, violations: checkFile(index, rel, readFileSync(join(root, rel), "utf8"), used) }));
  const stale = flags.has("--all") ? staleAllowEntries(index, used) : [];
  const summaryOnly = flags.has("--all") && !flags.has("--verbose");
  if (summaryOnly) printSummary(results);
  else {
    for (const { rel, violations } of results) {
      for (const { rule, message, hint } of violations) console.log(`${rel}: ${rule}: ${message}${hint ? ` (${hint})` : ""}`);
    }
  }
  for (const { name, globs } of stale) console.log(`vocabulary.yaml: stale allow entry ${name} (${globs.join(", ")}): no export in those files needs it, remove it`);
  const total = results.reduce((sum, result) => sum + result.violations.length, 0);
  if (!summaryOnly) console.log(`naming: ${total} violations in ${results.length} files${stale.length > 0 ? `, ${stale.length} stale allow entries` : ""}`);
  process.exit(total + stale.length > 0 ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
