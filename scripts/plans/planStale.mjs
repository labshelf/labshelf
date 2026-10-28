// `plan stale <session> <id>`: lists spec paths (edit, read, callers) changed between the spec's sha and HEAD.
import { execFileSync } from "node:child_process";
import { findSpec } from "./planFiles.mjs";

/** Returns the repo-relative changed paths that a spec names; a folder entry (trailing slash or dir) covers its contents. Throws on an unknown sha. */
export function planStale(root, { planDir, sessionId, specId }) {
  const spec = findSpec(planDir, sessionId, specId);
  if (!spec.sha) throw new Error(`spec ${specId} has no sha`);
  let changed;
  try {
    changed = execFileSync("git", ["diff", "--name-only", `${spec.sha}..HEAD`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .split("\n")
      .filter(Boolean);
  } catch (error) {
    throw new Error(`spec ${specId}: git diff ${spec.sha}..HEAD failed: ${String(error.stderr ?? error.message).trim().split("\n")[0]}`);
  }
  const named = [...(spec.edit ?? []), ...(spec.read ?? []), ...(spec.callers ?? [])].map((ref) => ref.path.replace(/\/+$/, ""));
  return changed.filter((file) => named.some((path) => file === path || file.startsWith(`${path}/`)));
}
