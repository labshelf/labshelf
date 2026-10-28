// Adds a marked block to the post-commit, post-merge and post-checkout git hooks that rebuilds the code-facts database in the background.
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOKS = ["post-commit", "post-merge", "post-checkout"];
const BEGIN = "# >>> labshelf code facts >>>";
const END = "# <<< labshelf code facts <<<";
const BLOCK = `${BEGIN}
nohup node "$(git rev-parse --show-toplevel)/scripts/code/facts.mjs" build --quiet >/dev/null 2>&1 &
${END}`;

const located = spawnSync("git", ["rev-parse", "--git-path", "hooks"], { cwd: ROOT, encoding: "utf8" });
if (located.status !== 0) throw new Error("not a git repository");
const hooksDir = resolve(ROOT, located.stdout.trim());
mkdirSync(hooksDir, { recursive: true });

for (const name of HOOKS) {
  const path = join(hooksDir, name);
  const current = existsSync(path) ? readFileSync(path, "utf8") : "#!/bin/sh\n";
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  // A re-run replaces only our block; anything else in the hook stays as it was.
  const next =
    start >= 0 && end > start
      ? `${current.slice(0, start)}${BLOCK}${current.slice(end + END.length)}`
      : `${current}${current.endsWith("\n") ? "" : "\n"}${BLOCK}\n`;
  writeFileSync(path, next);
  chmodSync(path, 0o755);
  process.stdout.write(`${path}\n`);
}
