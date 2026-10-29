// `plan finished <session>` records that the finishing pass passed on the current tree; `--check` compares a reopened session against it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { changedSince, treeState } from "../lint/gateRecord.mjs";
import { loadPlan } from "./planFiles.mjs";
import { finishedPath, runsDir } from "./planClose.mjs";

/** Writes `.git/labshelf-runs/<plan>/<session>.finished` holding the tree state; `plan close` removes it. Returns its path. */
export function markFinished(root, { planDir, sessionId }) {
  const file = finishedPath(runsDir(root), loadPlan(planDir).slug, sessionId);
  const { fingerprint, tree } = treeState(root);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${fingerprint} ${tree}\n`);
  return file;
}

/**
 * Compares the current tree with the session's finished marker.
 * Returns `{ state: "none" }`, `{ state: "unchanged" }`, or `{ state: "changed", files }` with the files changed since the pass.
 */
export function checkFinished(root, { planDir, sessionId }) {
  const file = finishedPath(runsDir(root), loadPlan(planDir).slug, sessionId);
  if (!existsSync(file)) return { state: "none" };
  const [fingerprint, tree] = readFileSync(file, "utf8").trim().split(/\s+/);
  const now = treeState(root);
  if (now.fingerprint === fingerprint) return { state: "unchanged" };
  try {
    return { state: "changed", files: changedSince(root, tree, now.tree) };
  } catch {
    // TRAP: gc may prune the unreferenced snapshot tree; without it the session counts as not finished.
    return { state: "none" };
  }
}
