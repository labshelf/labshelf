// Builds a throwaway git project on disk for the codemod tests.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function createProject(files) {
  const root = mkdtempSync(join(tmpdir(), "codemods-"));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  return { root, read: (path) => readFileSync(join(root, path), "utf8") };
}
