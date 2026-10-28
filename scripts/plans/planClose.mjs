// `plan close <session>`: gates once (or reuses the gate the finisher recorded for this exact tree), commits each finished package with only its paths, parks unfinished ones as patches, closes the session.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { parse } from "yaml";
import { emit } from "../agents/telemetry.mjs";
import { gatePassed, touchedPackages, treeState } from "../lint/gateRecord.mjs";
import { loadPlan, loadSession, saveSession, sessionPath } from "./planFiles.mjs";

const TRAILER = "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>";
const safeId = (text) => String(text).replace(/[^\w.-]/g, "_");
const posix = (path) => path.split("\\").join("/");
const covers = (path, file) => {
  const base = path.replace(/\/+$/, "");
  return file === base || file.startsWith(`${base}/`);
};

function git(root, args, { allowFail = false } = {}) {
  const run = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
  if (run.status !== 0 && !allowFail) throw new Error(`git ${args.join(" ")} failed: ${String(run.stderr || run.error?.message).trim().split("\n")[0]}`);
  return run;
}

/** Returns `[{ file, untracked }]` for every changed or new file (renames count as a delete plus an add). */
function changedFiles(root) {
  const parts = git(root, ["status", "--porcelain", "-z", "--untracked-files=all"]).stdout.split("\0").filter(Boolean);
  const out = [];
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i].slice(0, 2);
    out.push({ file: parts[i].slice(3), untracked: code === "??" });
    if (code[0] === "R" || code[0] === "C" || code[1] === "R" || code[1] === "C") out.push({ file: parts[++i], untracked: false });
  }
  return out;
}

export function runsDir(root) {
  if (process.env.LABSHELF_RUNS_DIR) return process.env.LABSHELF_RUNS_DIR;
  const common = git(root, ["rev-parse", "--git-common-dir"]).stdout.trim();
  return join(resolve(root, common), "labshelf-runs");
}

/** Returns "recorded" when a passing gate at least as strong already covers this exact tree, else runs it and returns "ran". */
function runGate(root, milestone) {
  if (gatePassed(root, { fingerprint: treeState(root).fingerprint, lint: milestone, packages: touchedPackages(root) })) return "recorded";
  const command = process.env.LABSHELF_CLOSE_GATE || (milestone ? "pnpm gate" : "pnpm gate --no-lint");
  const run = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 1 << 28 });
  if (run.status === 0) return "ran";
  const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
  throw new Error(`plan close: gate failed (${command}), nothing committed\n${tail}`);
}

/** Repo-relative paths a spec may change: edit, create, and the in-place copies of its hidden tests. */
function specPaths(spec) {
  const hiddenRoot = `documents/plans/${spec.plan}/tests/${spec.id}/`;
  const tests = (spec.tests?.hidden ?? []).map((path) => (path.startsWith(hiddenRoot) ? path.slice(hiddenRoot.length) : path));
  return [...(spec.edit ?? []).map((ref) => ref.path), ...(spec.create ?? []), ...tests];
}

export function reportStatus(runs, planSlug, specId) {
  const file = join(runs, safeId(planSlug), `${safeId(specId)}.report.yaml`);
  if (!existsSync(file)) return "no report";
  try {
    return parse(readFileSync(file, "utf8"))?.status ?? "no report";
  } catch {
    return "no report";
  }
}

/** The marker a passed finishing pass leaves for its session (see planFinished.mjs). */
export const finishedPath = (runs, planSlug, sessionId) => join(runs, safeId(planSlug), `${safeId(sessionId)}.finished`);

function commit(root, files, subject, body) {
  git(root, ["add", "-A", "--", ...files]);
  const message = body ? ["-m", subject, "-m", body, "-m", TRAILER] : ["-m", subject, "-m", TRAILER];
  git(root, ["commit", "-q", ...message, "--", ...files]);
  const hash = git(root, ["rev-parse", "HEAD"]).stdout.trim();
  emit("commit", { hash, files });
  return hash;
}

// Writes `git diff` of the tracked files plus a diff for each new file, then restores them (new files are deleted).
function parkAsPatch(root, files, patchFile) {
  const tracked = files.filter((f) => !f.untracked).map((f) => f.file);
  const created = files.filter((f) => f.untracked).map((f) => f.file);
  let patch = tracked.length > 0 ? git(root, ["diff", "HEAD", "--", ...tracked]).stdout : "";
  for (const file of created) patch += git(root, ["diff", "--no-index", "--", "/dev/null", file], { allowFail: true }).stdout;
  mkdirSync(join(patchFile, ".."), { recursive: true });
  writeFileSync(patchFile, patch);
  if (tracked.length > 0) git(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...tracked]);
  for (const file of created) rmSync(join(root, file), { force: true });
}

const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/**
 * Closes a session. Throws (nothing committed) when a changed file lies outside the session owns or the gate fails.
 * Returns `{ status: "done" | "blocked", commits: string[], gate: "recorded" | "ran" }`.
 */
export function planClose(root, { planDir, sessionId }) {
  const plan = loadPlan(planDir);
  const session = loadSession(planDir, sessionId);
  const planRel = posix(relative(root, planDir));

  // 1. Nothing outside the session owns (the plan folder holds the session's own bookkeeping).
  const outside = changedFiles(root).filter(({ file }) => !covers(planRel, file) && !session.owns.some((own) => covers(own, file)));
  if (outside.length > 0) throw new Error(`plan close: changed files outside the session owns, nothing committed:\n${outside.map((f) => `  ${f.file}`).join("\n")}`);

  // 2. Gate once.
  const gate = runGate(root, session.milestone === true);

  // 3 and 4. Per spec in session order: commit it, or park it.
  const runs = runsDir(root);
  const commits = [];
  const unfinished = [];
  let pool = changedFiles(root).filter(({ file }) => !covers(planRel, file));
  for (const spec of session.packages) {
    const paths = specPaths(spec);
    const mine = pool.filter(({ file }) => paths.some((path) => covers(path, file)));
    pool = pool.filter((entry) => !mine.includes(entry));
    const status = reportStatus(runs, plan.slug, spec.id);
    if (status === "done") {
      if (mine.length > 0) commits.push(commit(root, mine.map((f) => f.file), spec.goal, `Package ${spec.id} of plan ${plan.slug}`));
    } else {
      if (mine.length > 0) parkAsPatch(root, mine, join(runs, safeId(plan.slug), `${safeId(spec.id)}.patch`));
      unfinished.push(`${spec.id}: ${status}`);
    }
  }

  // 5. Log line, session state, then everything left inside owns.
  const status = unfinished.length === 0 ? "done" : "blocked";
  const line = status === "done" ? `session ${sessionId} done: ${session.packages.map((p) => p.id).join(", ")}` : `session ${sessionId} blocked: ${unfinished.join("; ")}`;
  appendFileSync(join(planDir, "log.md"), `- ${stamp()} — ${line}\n`);
  if (status === "done") rmSync(sessionPath(planDir, sessionId), { force: true });
  else saveSession(planDir, { ...session, status: "blocked", blocked_reason: unfinished.join("; ") });

  const rest = changedFiles(root);
  if (rest.length > 0) {
    const reviewFixes = rest.some(({ file }) => !covers(planRel, file));
    commits.push(commit(root, rest.map((f) => f.file), reviewFixes ? `Session ${sessionId} review fixes` : `Session ${sessionId} close`));
  }

  // 6. The finished marker only describes the open session.
  rmSync(finishedPath(runs, plan.slug, sessionId), { force: true });
  emit("session_closed", { status, commits: commits.length });
  return { status, commits, gate };
}
