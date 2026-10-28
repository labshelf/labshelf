// Checks out a commit into a throwaway folder so the checks can run on history (--head mode).
// The folder is a shared clone (no objects copied, nothing written to the source repo) with node_modules re-linked to the source repo's install.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";

function linkModules(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const name of readdirSync(sourceDir)) {
    const from = join(sourceDir, name);
    if (name === ".bin" || name === ".cache") continue;
    if (name.startsWith("@") && !lstatSync(from).isSymbolicLink()) {
      linkModules(from, join(targetDir, name));
      continue;
    }
    if (lstatSync(from).isSymbolicLink()) {
      const target = readlinkSync(from);
      // A relative link outside the .pnpm store is a workspace package link: keep it relative so it resolves inside the snapshot.
      if (!isAbsolute(target) && !target.includes(".pnpm")) {
        symlinkSync(target, join(targetDir, name));
        continue;
      }
    }
    symlinkSync(realpathSync(from), join(targetDir, name));
  }
}

function moduleFolders(root) {
  const found = [];
  const walk = (dir, depth) => {
    if (existsSync(join(dir, "node_modules"))) found.push(dir);
    if (depth === 0) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !["node_modules", ".git", "dist", "out"].includes(entry.name)) walk(join(dir, entry.name), depth - 1);
    }
  };
  walk(root, 2);
  return found;
}

// Returns { dir, dispose }. `sha` must exist in the source repo.
export function createSnapshot(root, sha) {
  const dir = mkdtempSync(join(tmpdir(), "diff-gate-snap-"));
  const dispose = () => rmSync(dir, { recursive: true, force: true });
  try {
    execFileSync("git", ["clone", "--shared", "--no-checkout", "--quiet", root, dir], { stdio: "ignore" });
    execFileSync("git", ["checkout", "--quiet", "--detach", sha], { cwd: dir, stdio: "ignore" });
    appendFileSync(join(dir, ".git/info/exclude"), "node_modules\n");
    for (const folder of moduleFolders(root)) {
      const rel = folder === root ? "" : folder.slice(root.length + 1);
      if (existsSync(join(dir, rel))) linkModules(join(folder, "node_modules"), join(dir, rel, "node_modules"));
    }
    return { dir: realpathSync(dir), dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
