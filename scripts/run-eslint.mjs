// Runs ESLint on the package in the current directory from the repo root, where ESLint and its config live.
import { spawnSync } from "node:child_process";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageDir = `packages/${basename(process.cwd())}`;

const run = spawnSync("pnpm", ["exec", "eslint", ...process.argv.slice(2), packageDir], { cwd: root, stdio: "inherit" });
process.exit(run.status ?? 1);
