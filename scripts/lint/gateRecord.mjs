// Tree state and the gate's PASS record, shared by `pnpm gate` (writes it) and `plan close` (skips its gate on a match).
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const git = (root, args, env) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"], env: env ? { ...process.env, ...env } : process.env }).trim();

/** Packages under `packages/` the uncommitted change touches; a change to core pulls in every app. */
export function touchedPackages(root) {
  const changed = new Set();
  for (const line of git(root, ["status", "--porcelain", "--untracked-files=all"]).split("\n")) {
    const match = line.slice(3).match(/^packages\/([^/]+)\//);
    if (match) changed.add(match[1]);
  }
  if (changed.has("core")) for (const app of ["vscode", "browser", "terminal"]) changed.add(app);
  return [...changed].filter((pkg) => existsSync(join(root, "packages", pkg, "package.json"))).sort();
}

/**
 * Snapshots the working tree (tracked changes and untracked, non-ignored files) as a git tree object, through a
 * copy of the index so the real one is untouched. Returns `{ head, tree, fingerprint }`; the fingerprint names the
 * exact tree state, and `tree` lets a later state be diffed against this one.
 */
export function treeState(root) {
  const head = git(root, ["rev-parse", "HEAD"]);
  const index = resolve(root, git(root, ["rev-parse", "--git-path", "index"]));
  const temp = `${index}.labshelf-snapshot-${process.pid}`;
  try {
    if (existsSync(index)) copyFileSync(index, temp);
    const env = { GIT_INDEX_FILE: temp };
    if (!existsSync(index)) git(root, ["read-tree", head], env);
    git(root, ["add", "-A"], env);
    const tree = git(root, ["write-tree"], env);
    return { head, tree, fingerprint: createHash("sha1").update(`${head} ${tree}`).digest("hex").slice(0, 12) };
  } finally {
    rmSync(temp, { force: true });
  }
}

/** Files that differ between two snapshot trees. */
export function changedSince(root, fromTree, toTree) {
  return git(root, ["diff", "--name-only", fromTree, toTree]).split("\n").filter(Boolean);
}

const recordFile = (root) => join(git(root, ["rev-parse", "--absolute-git-dir"]), "labshelf-gate");

/** Records a gate result: `<fingerprint> PASS|FAIL full|no-lint <pkg...>`. */
export function writeGateRecord(root, { fingerprint, passed, lint, packages }) {
  writeFileSync(recordFile(root), `${fingerprint} ${passed ? "PASS" : "FAIL"} ${lint ? "full" : "no-lint"} ${packages.join(" ")}`.trim() + "\n");
}

/** True when a PASS was recorded for this exact tree, at least as strong (a full gate covers a no-lint one), over every package. */
export function gatePassed(root, { fingerprint, lint, packages }) {
  const file = recordFile(root);
  if (!existsSync(file)) return false;
  const [recorded, verdict, mode, ...covered] = readFileSync(file, "utf8").trim().split(/\s+/);
  if (recorded !== fingerprint || verdict !== "PASS") return false;
  if (mode !== "full" && (lint || mode !== "no-lint")) return false;
  return packages.every((pkg) => covered.includes(pkg));
}
