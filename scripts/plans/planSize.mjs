// `plan size <paths…>`: counts what a change touches (files, packages, caller files, risk paths) and suggests a level N0..N3 (plan D10).
// Callers come from the code-facts index, opened read-only; paths it does not index, or no database, print `callers: ?`.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { isAbsolute, join, relative } from "node:path";

const RISK = ["documents/contracts", "sync", "storage", "formats", "manifest"];
const N0_MAX_CALLERS = 3;
const N1_MAX_FILES = 3;
const N2_MAX_FILES = 15;
const N2_MAX_PACKAGES = 2;

const toRepoPath = (root, path) => (isAbsolute(path) ? relative(root, path) : path).split("\\").join("/").replace(/^\.\//, "");
const packageOf = (path) => (path.startsWith("packages/") ? path.split("/")[1] : path.split("/")[0]);
const isRisk = (path) => RISK.some((word) => path.includes(word));

// Distinct files outside `paths` that import one of them or call into one of their units; null when any path is unindexed.
function callerFiles(dbPath, paths) {
  if (!existsSync(dbPath)) return null;
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const indexed = db.prepare("SELECT 1 FROM files WHERE path = ?");
    if (!paths.every((path) => indexed.get(path))) return null;
    const importers = db.prepare("SELECT from_file AS file FROM file_edges WHERE to_file = ?");
    const callsInto = db.prepare("SELECT DISTINCT c.file AS file FROM calls c JOIN units u ON u.id = c.callee_id WHERE u.file = ?");
    const found = new Set();
    for (const path of paths) for (const row of [...importers.all(path), ...callsInto.all(path)]) found.add(row.file);
    for (const path of paths) found.delete(path);
    return [...found].sort();
  } catch {
    return null; // unreadable or older schema: behave as if there were no index
  }
  finally {
    db?.close();
  }
}

/** The level for the counts; `callers` is a number, or null when unknown (then only files, packages and risk decide). */
export function suggestLevel({ files, packages, callers, risk }) {
  if (files === 1 && !risk && (callers === null || callers <= N0_MAX_CALLERS)) return "N0";
  if (files <= N1_MAX_FILES && packages === 1 && !risk) return "N1";
  if ((files <= N2_MAX_FILES && packages <= N2_MAX_PACKAGES) || risk) return "N2";
  return "N3";
}

/** The report lines for `paths` (repo-relative, or absolute under `root`). `dbPath` defaults to the facts database of `root`. */
export function planSize(root, paths, { dbPath } = {}) {
  const files = [...new Set(paths.map((path) => toRepoPath(root, path)))].sort();
  if (files.length === 0) throw new Error("plan size: at least one path is required");
  const db = dbPath ?? process.env.LABSHELF_FACTS_DB ?? join(root, ".code-facts", "facts.db");
  const callers = callerFiles(db, files);
  const packages = [...new Set(files.map(packageOf))].sort();
  const risk = files.filter(isRisk);
  const level = suggestLevel({ files: files.length, packages: packages.length, callers: callers?.length ?? null, risk: risk.length > 0 });
  return [
    `files: ${files.length}`,
    `packages: ${packages.length} (${packages.join(", ")})`,
    `callers: ${callers ? callers.length : "?"}`,
    `risk: ${risk.length > 0 ? risk.join(", ") : "none"}`,
    `suggested: ${level}`,
  ];
}
