// Shared helpers for the refactor codemods: the TypeScript compiler API and the project file list.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// PLATFORM: packages/core's `typescript` is v7 (native, no JS API); `typescript-js` is the v6 JS build.
export const ts = createRequire(join(toolRoot, "packages", "core", "package.json"))("typescript-js");

export const CODE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** Tracked and untracked (not ignored) files under the given repo-relative folders, as repo-relative paths. */
export function listFiles(root, folders) {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z", "--", ...folders], {
    cwd: root,
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.toString("utf8").split("\0").filter(Boolean);
}

/** Parses `--root <dir>` and `--dry-run` out of argv; returns the remaining positional arguments. */
export function parseArgs(argv) {
  const positional = [];
  const options = { root: toolRoot, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") options.root = resolve(argv[++i]);
    else if (argv[i] === "--dry-run") options.dryRun = true;
    else positional.push(argv[i]);
  }
  return { positional, options };
}
