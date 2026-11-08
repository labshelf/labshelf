// `plan close <session>`: gates once (or reuses the gate the finisher recorded for this exact tree), commits each finished package with only its paths, parks unfinished ones as patches and records them as carried, closes the session.
// It never blocks a session: files outside the session's owns are left in the tree for the next session to resolve, and a gate
// failure the session did not cause is recorded with `--accept-gate-failure <note>` instead of stopping the commit.
import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * Returns "recorded" when a passing gate at least as strong already covers this exact tree, else runs it and returns "ran".
 * A failing gate throws (nothing committed) unless `accepted` names why the failure is not the session's: then it returns "accepted".
 */
function runGate(root, milestone, accepted) {
  if (gatePassed(root, { fingerprint: treeState(root).fingerprint, lint: milestone, packages: touchedPackages(root) })) return "recorded";
  const command = process.env.LABSHELF_CLOSE_GATE || (milestone ? "pnpm gate" : "pnpm gate --no-lint");
  const run = spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 1 << 28 });
  if (run.status === 0) return "ran";
  if (accepted) return "accepted";
  const tail = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim().split("\n").slice(-20).join("\n");
  throw new Error(`plan close: gate failed (${command}), nothing committed. Fix failures in the session's files; when every failing test's source files are outside what this session changed, close again with --accept-gate-failure "<failing tests: why not this session's>"\n${tail}`);
}

/** Repo-relative paths a spec may change: edit, create, and the in-place copies of its hidden tests. */
function specPaths(spec) {
  const hiddenRoot = `documents/plans/${spec.plan}/tests/${spec.id}/`;
  const tests = (spec.tests?.hidden ?? []).map((path) => (path.startsWith(hiddenRoot) ? path.slice(hiddenRoot.length) : path));
  return [...(spec.edit ?? []).map((ref) => ref.path), ...(spec.create ?? []), ...tests];
}

/**
 * A package's status from its report. A report that names the follow-up package which finished its work
 * (`resolved_by: <spec id>`) is done once that package is; a package the main thread runs itself writes no report and
 * counts as done when the session closes, since closing is the main thread saying its work is finished.
 */
export function reportStatus(runs, planSlug, specId, spec, seen = new Set()) {
  const file = join(runs, safeId(planSlug), `${safeId(specId)}.report.yaml`);
  if (!existsSync(file)) return spec?.runner?.agent === "main" ? "done" : "no report";
  let report;
  try {
    report = parse(readFileSync(file, "utf8"));
  } catch {
    return "no report";
  }
  const status = report?.status ?? "no report";
  const by = typeof report?.resolved_by === "string" ? report.resolved_by.trim() : "";
  if (status === "done" || !by || seen.has(specId)) return status;
  seen.add(specId);
  return reportStatus(runs, planSlug, by, undefined, seen) === "done" ? "done" : `${status} (resolved_by ${by} not done)`;
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
 * Closes a session. Throws (nothing committed) only when the gate fails and `acceptGateFailure` is not given.
 * Returns `{ status: "done" | "carried", commits: string[], gate: "recorded" | "ran" | "accepted", carried: string[], left: string[] }`:
 * `carried` lists the unfinished packages (`<id>: <status>`), `left` the changed files outside the session owns, untouched.
 */
export function planClose(root, { planDir, sessionId, acceptGateFailure = "" }) {
  const plan = loadPlan(planDir);
  const session = loadSession(planDir, sessionId);
  // Real paths, so a symlinked temp or repo path (macOS /var -> /private/var) still puts the plan folder inside the repo.
  const planRel = posix(relative(realpathSync(root), realpathSync(planDir)));

  // 1. Files outside the session owns (the plan folder holds the session's own bookkeeping) stay as they are: the runner hands
  // them to the next session to resolve.
  const isOutside = ({ file }) => !covers(planRel, file) && !session.owns.some((own) => covers(own, file));
  const left = changedFiles(root).filter(isOutside).map((f) => f.file);

  // 2. Gate once.
  const gate = runGate(root, session.milestone === true, acceptGateFailure);

  // 3 and 4. Per spec in session order: commit it, or park it.
  const runs = runsDir(root);
  const commits = [];
  const unfinished = [];
  let pool = changedFiles(root).filter((f) => !covers(planRel, f.file) && !isOutside(f));
  for (const spec of session.packages) {
    const paths = specPaths(spec);
    const mine = pool.filter(({ file }) => paths.some((path) => covers(path, file)));
    pool = pool.filter((entry) => !mine.includes(entry));
    const status = reportStatus(runs, plan.slug, spec.id, spec);
    if (status === "done") {
      const body = `Package ${spec.id} of plan ${plan.slug}${gate === "accepted" ? `\n\nGate failure accepted: ${acceptGateFailure}` : ""}`;
      if (mine.length > 0) commits.push(commit(root, mine.map((f) => f.file), spec.goal, body));
    } else {
      if (mine.length > 0) parkAsPatch(root, mine, join(runs, safeId(plan.slug), `${safeId(spec.id)}.patch`));
      unfinished.push(`${spec.id}: ${status}`);
    }
  }

  // 5. Log line, session state, then everything left inside owns. Unfinished packages are carried, never blocking: the
  // session stays in the queue and the next session the runner starts resolves them first.
  const status = unfinished.length === 0 ? "done" : "carried";
  const notes = [
    gate === "accepted" ? `gate failure accepted: ${acceptGateFailure}` : "",
    left.length > 0 ? `left outside owns: ${left.join(", ")}` : "",
  ].filter(Boolean).map((note) => ` (${note})`).join("");
  const line = status === "done" ? `session ${sessionId} done: ${session.packages.map((p) => p.id).join(", ")}` : `session ${sessionId} carried: ${unfinished.join("; ")}`;
  appendFileSync(join(planDir, "log.md"), `- ${stamp()} — ${line}${notes}\n`);
  if (status === "done") rmSync(sessionPath(planDir, sessionId), { force: true });
  else {
    const { blocked_reason: _legacy, ...kept } = session;
    saveSession(planDir, { ...kept, status: "carried", carried: unfinished });
  }

  const rest = changedFiles(root).filter((f) => !isOutside(f));
  if (rest.length > 0) {
    const reviewFixes = rest.some(({ file }) => !covers(planRel, file));
    commits.push(commit(root, rest.map((f) => f.file), reviewFixes ? `Session ${sessionId} review fixes` : `Session ${sessionId} close`));
  }

  // 6. The finished marker only describes the open session.
  rmSync(finishedPath(runs, plan.slug, sessionId), { force: true });
  emit("session_closed", { status, commits: commits.length });
  return { status, commits, gate, carried: unfinished, left };
}
