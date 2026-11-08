// Runs every session of an approved plan unattended, one fresh headless Claude process per session, so each session
// starts with an empty context. It never stops on a session: it stops only when no session is left (or --max-sessions).
// Usage: node scripts/plans/runPlan.mjs documents/plans/<slug> [--model opus] [--permission-mode auto]
//        [--max-sessions N] [--max-budget-usd N] [--lint-every N] [--no-wait] [--resume] [--dry-run]
// Plans are `plan.yaml` + `sessions/<id>.yaml` (run in `depends_on` order; a session whose dependency is unfinished still
// runs) or the older `plan.md` + `sessions/*.md`. --dry-run prints the ordered queue and runs nothing.
// Telemetry (scripts/agents/telemetry.mjs): run_started, session_started, session_closed, all under LABSHELF_PLAN_RUN_ID.
// Every N-th session counted back from the last one (default 5, and always the last) is a lint milestone that runs
// the full gate, lint and baseline updates; the others run only typecheck and tests. --lint-every 0: last only.
// Usage limit: after a failed or stalled session the runner sends a one-line probe prompt on the same model; while the
// probe fails it stands by (until the reset time the message names, else re-probing every 20 minutes), then runs the same
// session again, telling it that the uncommitted changes are its own partial work. --no-wait does not stand by: the
// failure counts as a run. A session silent for 60 minutes counts as stalled and is killed.
// A session that ends unfinished (failed, stalled, pending, or closed with packages carried) runs again in a fresh
// process, up to MAX_RUNS runs; a run that crossed the context warning after progress does not count. Then the runner moves
// on without blocking anything: the next session (a dependent one first) gets a carry-over line naming the unfinished
// packages and resolves them before its own. Changes left in the tree after a session go to the next session the same way.
// When the queue is through, every session still unfinished gets one more run. --resume runs the first session on top
// of the uncommitted changes a stopped run left behind, as its own partial work.
// Logs: <git dir>/plan-runs/<slug>/<session>-<time>.jsonl (the stream-json transcript of each session).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { emit } from "../agents/telemetry.mjs";
import { reportStatus, runsDir } from "./planClose.mjs";
import { loadPlan, loadSession, planPath } from "./planFiles.mjs";
import { pendingSessions, planQueue } from "./planQueue.mjs";

// LABSHELF_PLAN_ROOT points the runner at another repo; the end-to-end tests use it with a temp git repo.
const root = process.env.LABSHELF_PLAN_ROOT ? resolve(process.env.LABSHELF_PLAN_ROOT) : resolve(import.meta.dirname, "..", "..");

// The repo's git directory; in a worktree `.git` is a file, so ask git.
function gitDir() {
  const run = spawnSync("git", ["rev-parse", "--git-dir"], { cwd: root, encoding: "utf8" });
  const out = run.status === 0 ? run.stdout.trim() : "";
  return out ? resolve(root, out) : join(root, ".git");
}
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function parseArgs(argv) {
  const options = { model: "opus", permissionMode: "auto", maxSessions: Infinity, maxBudgetUsd: null, dryRun: false, wait: true, resume: false, lintEvery: 5, planDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model") options.model = argv[++i];
    else if (arg === "--permission-mode") options.permissionMode = argv[++i];
    else if (arg === "--max-sessions") options.maxSessions = Number(argv[++i]);
    else if (arg === "--max-budget-usd") options.maxBudgetUsd = Number(argv[++i]);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--no-wait") options.wait = false;
    else if (arg === "--resume") options.resume = true;
    else if (arg === "--lint-every") options.lintEvery = Number(argv[++i]);
    else if (!options.planDir) options.planDir = arg.replace(/\/+$/, "");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.planDir) throw new Error("usage: node scripts/plans/runPlan.mjs documents/plans/<slug> [options]");
  return options;
}

// The working tree's state (changed and untracked paths plus the diff), so files written without a commit count as progress.
const treeFingerprint = () => createHash("sha256")
  .update(git("status", "--porcelain", "--untracked-files=all")).update(git("diff", "HEAD")).digest("hex");

function ensureBranch(slug) {
  const branch = git("branch", "--show-current");
  if (branch !== "main" && branch !== "master") return branch;
  const target = `refactor/${slug}`;
  const exists = git("branch", "--list", target) !== "";
  git("switch", ...(exists ? [target] : ["-c", target]));
  console.log(`[plan] switched from ${branch} to ${target}`);
  return target;
}

// The rules live in the orchestrate skill (one source); the runner only names the modes that apply.
const RULES = ".claude/skills/orchestrate/references/unattended.md";
const UNATTENDED = `Unattended run: follow ${RULES}, sections "Unattended" and "Testing policy".`;

const MILESTONE = `This session is a lint milestone: also follow the "Lint milestone" section of ${RULES}.`;

// Counted back from the last session, so a restart or a remainder file keeps the milestones stable.
const isMilestone = (pendingCount, every) => pendingCount === 1 || (every > 0 && pendingCount % every === 1);

// The changes left in the tree that no session committed: they are handed to the next session to resolve.
const leftoverLine = (files) => `The working tree holds changes no session committed: ${files.join(", ")}. Before your own packages, resolve them as the "Carry-over" section of ${RULES} says (keep and commit what is correct, fix what breaks typecheck or tests, revert what is wrong) and commit the result.`;

// The sessions given up on that this session resolves first: `{ id, why, packages: [{ id, goal, status }] }`.
const carryLine = (carried, planDir) => `These sessions did not finish and are carried to you: ${carried.map((c) => `session ${c.id} (${c.why}; ` +
  (c.packages.length > 0 ? `unfinished: ${c.packages.map((p) => `${p.id} "${p.goal}" [${p.status}]`).join(", ")}` : "the whole session") + ")").join("; ")}. ` +
  `Before your own packages, resolve them as the "Carry-over" section of ${RULES} says: run their unfinished packages from ${planDir}/sessions/<id>.yaml (or <id>.md) and close each with \`plan close <id>\`.`;

const resumeLine = (entry) => `This session is resumed after an interrupted run: also follow the "Resume" section of ${RULES}.` +
  (entry.format === "yaml" ? ` Start with \`node scripts/plans/plan.mjs finished ${entry.id} --check\`: on "finished on this tree" run \`plan close ${entry.id}\` and nothing else; on "changed since the finishing pass" run \`finish session\` only on the files it lists, then \`plan close\`.` : "");

const LIMIT = /usage limit|hit your limit|limit reached|limit will reset/i;
const RESET_EPOCH = /limit reached\|(\d{10})/i;
const RESET_CLOCK = /resets?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const FALLBACK_WAIT_MS = 20 * 60 * 1000;
const MARGIN_MS = 3 * 60 * 1000;
const STALL_MS = 60 * 60 * 1000;
const MAX_RESUMES = 10; // usage-limit waits for one session; past them a failed run counts as a run
const MAX_RUNS = 3; // fresh-process runs of one unfinished session before the runner carries it and moves on
const MAX_BUDGET_RESTARTS = 5; // context-warning restarts after progress that do not count as a run

// Returns when to retry if the text says the usage limit was hit, else null.
function limitRetryAt(text, now = new Date()) {
  if (!LIMIT.test(text)) return null;
  const epoch = RESET_EPOCH.exec(text);
  if (epoch) return Number(epoch[1]) * 1000 + MARGIN_MS;
  const clock = RESET_CLOCK.exec(text);
  if (clock) {
    let hours = Number(clock[1]) % 12;
    if (!clock[3]) hours = Number(clock[1]);
    else if (clock[3].toLowerCase() === "pm") hours += 12;
    const reset = new Date(now);
    reset.setHours(hours, Number(clock[2] ?? 0), 0, 0);
    if (reset <= now) reset.setDate(reset.getDate() + 1);
    return reset.getTime() + MARGIN_MS;
  }
  return now.getTime() + FALLBACK_WAIT_MS;
}

async function sleepUntil(time) {
  for (let left = time - Date.now(); left > 0; left = time - Date.now()) {
    console.log(`[plan] standing by: ${Math.ceil(left / 60000)} min left (until ${new Date(time).toLocaleString()})`);
    await new Promise((done) => setTimeout(done, Math.min(left, 10 * 60 * 1000)));
  }
}

// A one-line prompt on the session's model: null when Claude answers, else the time to probe again.
function probeUsage(model) {
  const run = spawnSync("claude", ["-p", "Reply with OK.", "--model", model, "--output-format", "json"],
    { cwd: root, encoding: "utf8", timeout: 5 * 60 * 1000 });
  let parsed = null;
  try { parsed = JSON.parse(run.stdout); } catch {}
  if (run.status === 0 && parsed && !parsed.is_error) return null;
  const text = `${run.stderr ?? ""}\n${parsed?.result ?? run.stdout ?? ""}`;
  console.log(`[plan] probe failed: ${text.trim().split("\n").pop()?.slice(0, 160) ?? "no output"}`);
  return limitRetryAt(text) ?? Date.now() + FALLBACK_WAIT_MS;
}

// Stands by until Claude answers again. Returns false when it answered at once (the failure was not the limit).
async function waitForUsage(model, firstRetryAt) {
  let retryAt = firstRetryAt ?? probeUsage(model);
  if (retryAt === null) return false;
  while (retryAt !== null) {
    await sleepUntil(retryAt);
    retryAt = probeUsage(model);
  }
  console.log("[plan] Claude answers again; resuming");
  return true;
}

// Runs the `build` of the code-facts index before a session; a failure only warns.
function refreshFacts() {
  const facts = join(root, "scripts", "code", "facts.mjs");
  if (!existsSync(facts)) return;
  const run = spawnSync("node", [facts, "build", "--quiet"], { cwd: root, stdio: "ignore" });
  if (run.status !== 0) console.log(`[plan] warning: facts build failed (exit ${run.status}); continuing`);
}

function runSession(options, slug, entry, logPath, { resume, milestone, warnFile, leftover, carried }) {
  const session = entry.id;
  const prompt = entry.format === "yaml"
    ? `/orchestrate ${options.planDir}/plan.yaml session ${session}`
    : `/orchestrate ${options.planDir}/plan.md session ${session}`;
  const system = [UNATTENDED, milestone ? MILESTONE : "", resume ? resumeLine(entry) : "",
    leftover.length > 0 ? leftoverLine(leftover) : "", carried.length > 0 ? carryLine(carried, options.planDir) : ""].filter(Boolean).join(" ");
  if (leftover.length > 0) console.log(`[plan] session ${session} resolves the leftover changes first: ${leftover.join(", ")}`);
  if (carried.length > 0) console.log(`[plan] session ${session} resolves the carried sessions first: ${carried.map((c) => c.id).join(", ")}`);
  if (milestone) console.log(`[plan] session ${session} is a lint milestone`);
  const args = ["-p", prompt, "--model", options.model, "--permission-mode", options.permissionMode, "--permission-prompts", "none",
    "--output-format", "stream-json", "--verbose", "--append-system-prompt", system];
  if (options.maxBudgetUsd !== null) args.push("--max-budget-usd", String(options.maxBudgetUsd));
  console.log(`[plan] ${slug} session ${session}: claude ${args.slice(0, 6).join(" ")} …`);
  console.log(`[plan] transcript: ${logPath}`);
  return new Promise((resolvePromise) => {
    // In `claude -p` ending the turn ends the process, so the session must never wait on a background task: with
    // background tasks disabled subagents and Bash run in the foreground and the main thread never polls. Without
    // auto-backgrounding a long command (the core suite and pnpm gate take ~7 min) would hit the 2 min Bash default,
    // so its timeout is raised. Values already set in the parent environment win.
    const env = {
      CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", BASH_DEFAULT_TIMEOUT_MS: "600000",
      ...process.env, LABSHELF_PLAN: slug, LABSHELF_PLAN_SESSION: session, LABSHELF_BUDGET_WARN_FILE: warnFile,
    };
    const child = spawn("claude", args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    const log = createWriteStream(logPath);
    let result = null;
    let stderr = "";
    let lastText = "";
    child.stderr.on("data", (chunk) => { process.stderr.write(chunk); stderr = (stderr + chunk).slice(-4000); });
    const onSignal = () => child.kill("SIGINT");
    process.on("SIGINT", onSignal);
    let lastEvent = Date.now();
    let stalled = false;
    const watchdog = setInterval(() => {
      if (Date.now() - lastEvent < STALL_MS) return;
      stalled = true;
      console.log(`[plan] no event for ${STALL_MS / 60000} min; killing the session`);
      child.kill("SIGTERM");
    }, 60 * 1000);
    createInterface({ input: child.stdout }).on("line", (line) => {
      lastEvent = Date.now();
      log.write(`${line}\n`);
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "system" && event.subtype === "init") emit("session_started", { session, session_id: event.session_id, model: event.model ?? options.model });
      if (event.type === "result") result = event;
      if (event.type === "assistant") {
        for (const part of event.message?.content ?? []) {
          if (part.type === "text" && part.text.trim()) {
            lastText = part.text;
            console.log(`  │ ${part.text.trim().split("\n")[0].slice(0, 160)}`);
          }
          if (part.type === "tool_use" && part.name === "Agent") console.log(`  │ → agent: ${part.input?.description ?? ""}`);
        }
      }
    });
    child.on("close", (code) => {
      clearInterval(watchdog);
      process.off("SIGINT", onSignal);
      log.end();
      // Only the last words of the run say why it stopped; earlier text may discuss rate limits in the code itself.
      resolvePromise({ code, result, stalled, tail: `${stderr}\n${lastText.slice(-1000)}\n${result?.result ?? ""}` });
    });
  });
}

// Where a session stands after a run: "done" (file gone), or its YAML status ("pending", "carried", legacy "blocked").
function sessionState(planDir, entry) {
  if (entry.format === "md") return pendingSessions(planDir).some((e) => e.id === entry.id) ? "pending" : "done";
  if (!existsSync(entry.file)) return "done";
  return loadSession(planDir, entry.id).status;
}

// Packages of a YAML session whose report says done; 0 for an .md session or a session file already gone.
function donePackages(planDir, slug, entry) {
  if (entry.format !== "yaml" || !existsSync(entry.file)) return 0;
  const runs = runsDir(root);
  return loadSession(planDir, entry.id).packages.filter((spec) => reportStatus(runs, slug, spec.id, spec) === "done").length;
}

// The packages of a session that are not done, as `{ id, goal, status }`; [] for an .md session or a closed one.
function unfinishedPackages(planDir, slug, entry) {
  if (entry.format !== "yaml" || !existsSync(entry.file)) return [];
  const runs = runsDir(root);
  return loadSession(planDir, entry.id).packages
    .map((spec) => ({ id: spec.id, goal: spec.goal, status: reportStatus(runs, slug, spec.id, spec) }))
    .filter((p) => p.status !== "done");
}

// The open dependencies of a YAML session; [] for an .md session.
const dependsOn = (planDir, entry) => (entry.format === "yaml" && existsSync(entry.file) ? loadSession(planDir, entry.id).depends_on ?? [] : []);

// The next session: a dependent of a carried session whose other dependencies are all done or carried, else the first.
function pickNext(planDir, candidates, carried) {
  if (carried.length === 0) return candidates[0];
  const waiting = new Set(candidates.map((e) => e.id));
  const carriedIds = new Set(carried.map((c) => c.id));
  return candidates.find((e) => {
    const deps = dependsOn(planDir, e);
    return deps.some((d) => carriedIds.has(d)) && deps.every((d) => !waiting.has(d));
  }) ?? candidates[0];
}

// Paths changed or added in the tree (untrimmed porcelain: its first column may be a space; a rename lists both paths).
const changedPaths = () => execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8" })
  .split("\0").filter(Boolean).map((entry) => (/^[ MADRCU?!]{2} /.test(entry) ? entry.slice(3) : entry));

function planStatus(planDir, label) {
  if (existsSync(planPath(planDir))) {
    const status = loadPlan(planDir).status;
    return { status, ok: status === "approved" || status === "in_progress" };
  }
  const planFile = join(planDir, "plan.md");
  if (!existsSync(planFile)) throw new Error(`no plan at ${label}/plan.yaml or ${label}/plan.md`);
  const status = /^Status:\s*(.+)$/m.exec(readFileSync(planFile, "utf8"))?.[1]?.trim() ?? "";
  return { status, ok: /^(approved|in progress)/.test(status) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const planDir = resolve(root, options.planDir);
  const slug = basename(planDir);
  const runId = process.env.LABSHELF_PLAN_RUN_ID || randomUUID();
  process.env.LABSHELF_PLAN_RUN_ID = runId;
  process.env.LABSHELF_PLAN = slug;
  const plan = planStatus(planDir, options.planDir);
  if (!plan.ok) throw new Error(`plan status is "${plan.status}"; approve it first`);
  const { queue: initial, skipped } = planQueue(planDir);
  console.log(`[plan] ${slug}: ${initial.length} sessions pending: ${initial.map((e) => e.id).join(", ")}`);
  for (const s of skipped) console.log(`[plan] note ${s.id}: ${s.reason}`);
  const milestones = initial.filter((_, i) => isMilestone(initial.length - i, options.lintEvery));
  console.log(`[plan] lint milestones: ${milestones.map((e) => e.id).join(", ")}`);
  if (options.dryRun) return;
  emit("run_started", { options: { ...options, maxSessions: Number.isFinite(options.maxSessions) ? options.maxSessions : null } });
  ensureBranch(slug);
  const logDir = join(gitDir(), "plan-runs", slug);
  mkdirSync(logDir, { recursive: true });

  let ran = 0;
  let resume = options.resume ? initial[0]?.id ?? null : null; // the session whose own partial work the tree holds
  const runs = new Map(); // counted runs of each session in this pass
  const resumes = new Map();
  const budgetRestarts = new Map();
  const costs = new Map();
  const given = new Set(); // sessions carried in this pass
  const outcome = new Map(); // session id -> its last status line, for the summary
  let carried = []; // sessions given up on, handed to the next session that runs
  let handed = null; // { session, leftover, carried }: what the current session resolves first, kept across its reruns
  let finalPass = false;
  for (;;) {
    const { queue } = planQueue(planDir);
    if (queue.length === 0) break;
    const candidates = queue.filter((e) => !given.has(e.id));
    if (candidates.length === 0) {
      if (finalPass) break;
      finalPass = true;
      given.clear();
      runs.clear();
      carried = [];
      console.log(`[plan] end of the queue; one more run for each unfinished session: ${queue.map((e) => e.id).join(", ")}`);
      continue;
    }
    if (ran >= options.maxSessions) { console.log(`[plan] stopped after ${ran} sessions (--max-sessions)`); break; }
    const entry = resume && candidates.some((e) => e.id === resume) ? candidates.find((e) => e.id === resume) : pickNext(planDir, candidates, carried);
    const session = entry.id;
    if (handed?.session !== session) {
      const open = new Set(queue.map((e) => e.id));
      handed = { session, leftover: resume === session ? [] : changedPaths(), carried: carried.filter((c) => c.id !== session && open.has(c.id)) };
      carried = [];
    }

    const headBefore = git("rev-parse", "HEAD");
    const started = Date.now();
    const doneBefore = donePackages(planDir, slug, entry);
    const treeBefore = treeFingerprint();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const warnFile = join(logDir, `${session}-${stamp}.budget-warn.json`);
    refreshFacts();
    const { code, result, stalled, tail } = await runSession(options, slug, entry, join(logDir, `${session}-${stamp}.jsonl`), {
      resume: resume === session, milestone: isMilestone(queue.length, options.lintEvery), warnFile, leftover: handed.leftover, carried: handed.carried,
    });
    costs.set(session, (costs.get(session) ?? 0) + (result?.total_cost_usd ?? 0));
    const closeEvent = (status) => emit("session_closed", {
      session, status, commits: Number(git("rev-list", "--count", `${headBefore}..HEAD`)), cost_usd: costs.get(session),
    });
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`\n[plan] session ${session} ended in ${minutes} min, exit ${code}` +
      (result?.total_cost_usd ? `, $${result.total_cost_usd.toFixed(2)}` : ""));
    if (result?.result) console.log(result.result.trim().split("\n").map((l) => `  ${l}`).join("\n"));
    if (git("rev-parse", "HEAD") !== headBefore) console.log(`[plan] commits: ${git("log", "--oneline", `${headBefore}..HEAD`).split("\n").join(" | ")}`);

    const budgetWarned = existsSync(warnFile);
    const failed = !budgetWarned && (stalled || code !== 0 || !result || result.is_error);
    if (failed && options.wait && (resumes.get(session) ?? 0) < MAX_RESUMES) {
      console.log(`[plan] session ${session} ${stalled ? "stalled" : "failed"}; checking whether Claude is at the usage limit`);
      if (await waitForUsage(options.model, limitRetryAt(tail))) {
        resumes.set(session, (resumes.get(session) ?? 0) + 1);
        resume = session;
        continue;
      }
    }
    const state = sessionState(planDir, entry);
    if (state === "done") {
      ran++;
      resume = null;
      handed = null;
      outcome.set(session, "done");
      console.log(`[plan] session ${session}: done\n`);
      closeEvent("done");
      continue;
    }
    // A context warning after progress runs the session again in a fresh process without counting a run.
    const progressed = git("rev-parse", "HEAD") !== headBefore || donePackages(planDir, slug, entry) > doneBefore || treeFingerprint() !== treeBefore;
    if (budgetWarned && progressed && (budgetRestarts.get(session) ?? 0) < MAX_BUDGET_RESTARTS) {
      budgetRestarts.set(session, (budgetRestarts.get(session) ?? 0) + 1);
      console.log(`[plan] session ${session} crossed the context warning and ended pending after progress; running it again in a fresh process (${budgetRestarts.get(session)}/${MAX_BUDGET_RESTARTS})`);
      resume = session;
      continue;
    }
    const why = stalled ? "stalled" : failed ? `failed (exit ${code}, ${result?.subtype ?? "no result"})`
      : state === "pending" ? (progressed ? "ended pending" : "ended pending without progress") : `closed with packages ${state}`;
    const cap = finalPass ? 1 : MAX_RUNS;
    runs.set(session, (runs.get(session) ?? 0) + 1);
    if (runs.get(session) < cap) {
      console.log(`[plan] session ${session} ${why}; running it again in a fresh process (run ${runs.get(session) + 1}/${cap})`);
      resume = session;
      continue;
    }
    // Moves on without blocking: the next session resolves what this one left, and the dependents still run.
    const packages = unfinishedPackages(planDir, slug, entry);
    ran++;
    resume = null;
    given.add(session);
    carried = [...handed.carried, { id: session, why, packages }];
    handed = null;
    const ids = packages.map((p) => p.id).join(", ") || "whole session";
    outcome.set(session, `carried (${ids})`);
    console.log(`[plan] session ${session}: carried (${ids}; ${why}); the next session resolves it first\n`);
    closeEvent("carried");
  }
  const left = planQueue(planDir).queue.map((e) => e.id);
  console.log(`[plan] ${slug}: summary after ${ran} sessions:`);
  for (const [id, line] of outcome) console.log(`[plan]   ${id}: ${left.includes(id) ? line : "done"}`);
  console.log(left.length === 0 ? `[plan] ${slug}: no sessions left.` : `[plan] ${slug}: still unfinished: ${left.join(", ")} (see ${options.planDir}/log.md and the transcripts in ${logDir})`);
  if (changedPaths().length > 0) console.log(`[plan] uncommitted changes left: ${changedPaths().join(", ")}`);
}

main().catch((error) => {
  console.error(`[plan] STOP: ${error.message}`);
  process.exit(1);
});
