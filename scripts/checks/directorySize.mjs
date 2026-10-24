// Structure rule for packages/*/src: a folder holds at most 25 source files directly, and a non-runtime
// subfolder that holds no subfolders holds at least 2 source files besides index.ts (fold smaller ones into the parent).
import { existsSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_FILES = 25;
export const MIN_FILES = 2;
const RUNTIME_FOLDERS = new Set(["node", "dom", "worker", "webview"]);

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const isSourceFile = (name) => /\.(ts|tsx|css)$/.test(name) && name !== "index.ts" && !name.endsWith(".d.ts");

function collectProblems(root, dir, isSrcRoot, problems) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const count = entries.filter((entry) => entry.isFile() && isSourceFile(entry.name)).length;
  const hasSubfolders = entries.some((entry) => entry.isDirectory());
  const name = dir.slice(dir.lastIndexOf("/") + 1);
  const path = relative(root, dir);
  if (count > MAX_FILES) problems.push(`${path} holds ${count} source files (limit ${MAX_FILES}). Split it into subfolders named by vocabulary terms.`);
  if (!isSrcRoot && !RUNTIME_FOLDERS.has(name) && !hasSubfolders && count < MIN_FILES) {
    problems.push(`${path} holds ${count} source files besides index.ts (minimum ${MIN_FILES}). Fold it into its parent folder.`);
  }
  for (const entry of entries) {
    if (entry.isDirectory()) collectProblems(root, join(dir, entry.name), false, problems);
  }
}

// One message per offending folder under <root>/packages/<pkg>/src.
export function findProblems(root = defaultRoot) {
  const problems = [];
  const packages = join(root, "packages");
  if (!existsSync(packages)) return problems;
  for (const pkg of readdirSync(packages)) {
    const src = join(packages, pkg, "src");
    if (existsSync(src)) collectProblems(root, src, true, problems);
  }
  return problems;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = findProblems();
  for (const problem of problems) console.error(problem);
  console.log(`directory structure: ${problems.length} folders break the rule (max ${MAX_FILES} files per folder, min ${MIN_FILES} per non-runtime subfolder)`);
  process.exit(problems.length > 0 ? 1 : 0);
}
