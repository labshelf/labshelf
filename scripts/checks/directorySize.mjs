// Structure rule for packages/*/src: a folder holds at most 25 source files directly, and a subfolder that holds no
// subfolders holds at least 2 source files besides index.ts (fold smaller ones into the parent).
// Exempt from the minimum: domain folders (top level), runtime folders and feature home folders of vocabulary.yaml.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { globToRegExp } from "./namingRules.mjs";

export const MAX_FILES = 25;
export const MIN_FILES = 2;
const RUNTIME_FOLDERS = new Set(["node", "dom", "worker", "webview"]);

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// Regexps for the folders named by `features.*.home` globs (a trailing /** is the folder itself), relative to src.
function loadHomeFolders(root) {
  const path = join(root, "scripts/checks/vocabulary.yaml");
  if (!existsSync(path)) return [];
  const { parse } = createRequire(join(defaultRoot, "packages/core/package.json"))("yaml");
  const features = parse(readFileSync(path, "utf8")).features ?? {};
  return Object.values(features).flatMap((feature) => feature.home ?? []).map((glob) => globToRegExp(glob.replace(/\/\*\*$/, "")));
}

const toPosix = (path) => path.split(sep).join("/");
const isSourceFile = (name) => /\.(ts|tsx|css)$/.test(name) && name !== "index.ts" && !name.endsWith(".d.ts");

function collectProblems(context, dir, depth, problems) {
  const { root, src, homes } = context;
  const entries = readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((entry) => entry.isFile() && isSourceFile(entry.name)).length;
  const hasSubfolders = entries.some((entry) => entry.isDirectory());
  const name = dir.slice(dir.lastIndexOf("/") + 1);
  const exempt = depth <= 1 || RUNTIME_FOLDERS.has(name) || homes.some((home) => home.test(toPosix(relative(src, dir))));
  const path = relative(root, dir);
  if (count > MAX_FILES) problems.push(`${path} holds ${count} source files (limit ${MAX_FILES}). Split it into subfolders named by vocabulary terms.`);
  if (!exempt && !hasSubfolders && count < MIN_FILES) {
    problems.push(`${path} holds ${count} source files besides index.ts (minimum ${MIN_FILES}). Fold it into its parent folder.`);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) collectProblems(context, join(dir, entry.name), depth + 1, problems);
  }
}

// One message per offending folder under <root>/packages/<pkg>/src.
export function findProblems(root = defaultRoot) {
  const problems = [];
  const homes = loadHomeFolders(root);
  const packages = join(root, "packages");
  if (!existsSync(packages)) return problems;
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, "src");
    if (existsSync(src)) collectProblems({ root, src, homes }, src, 0, problems);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findProblems();
  for (const problem of problems) console.error(problem);
  console.log(`directory structure: ${problems.length} folders break the rule (max ${MAX_FILES} files per folder, min ${MIN_FILES} per subfolder)`);
  process.exit(problems.length > 0 ? 1 : 0);
}
