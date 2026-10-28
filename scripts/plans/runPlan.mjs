// Runs every session of an approved plan unattended, one fresh headless Claude process per session, so each session
// starts with an empty context. Stops at the first session that fails, leaves the tree dirty or makes no progress.
// Usage: node scripts/plans/runPlan.mjs documents/plans/<slug> [--model opus] [--permission-mode auto]
//        [--max-sessions N] [--max-budget-usd N] [--lint-every N] [--no-wait] [--resume] [--dry-run]
// Plans are `plan.yaml` + `sessions/<id>.yaml` (run in `depends_on` order; a session that ends blocked is logged and the
// runner goes on with the sessions that do not depend on it) or the older `plan.md` + `sessions/*.md`.
// --dry-run prints the ordered queue (and the sessions it leaves out) and runs nothing.
// Telemetry (scripts/agents/telemetry.mjs): run_started, session_started, session_closed, all under LABSHELF_PLAN_RUN_ID.
// Every N-th session counted back from the last one (default 5, and always the last) is a lint milestone that runs
// the full gate, lint and baseline updates; the others run only typecheck and tests. --lint-every 0: last only.
// The runner itself detects the usage limit, without relying on any agent: after a failed or stalled session it sends
// a one-line probe prompt on the same model; while the probe fails it stands by (until the reset time the message
// names, else re-probing every 20 minutes), then runs the same session again, telling it that the uncommitted changes
// are its own partial work. A session silent for 60 minutes counts as stalled and is killed. --no-wait stops instead. --resume does the same
// by hand: it runs the first pending session on top of the uncommitted changes a stopped run left behind.
// Logs: .git/plan-runs/<slug>/<session>-<time>.jsonl (the stream-json transcript of each session).
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { emit } from "../agents/telemetry.mjs";
import { loadPlan, loadSession, planPath } from "./planFiles.mjs";
import { pendingSessions, planQueue } from "./planQueue.mjs";

// LABSHELF_PLAN_ROOT points the runner at another repo; the end-to-end tests use it with a temp git repo.
const root = process.env.LABSHELF_PLAN_ROOT ? resolve(process.env.LABSHELF_PLAN_ROOT) : resolve(import.meta.dirname, "..", "..");
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

const dirtyTracked = () => git("status", "--porcelain", "--untracked-files=no");

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

const RESUME = `This session is resumed after an interrupted run: also follow the "Resume" section of ${RULES}.`;

const LIMIT = /usage limit|hit your limit|limit reached|limit will reset/i;
const RESET_EPOCH = /limit reached\|(\d{10})/i;
const RESET_CLOCK = /resets?(?: at)? (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
const FALLBACK_WAIT_MS = 20 * 60 * 1000;
const MARGIN_MS = 3 * 60 * 1000;
const STALL_MS = 60 * 60 * 1000;
const MAX_RESUMES = 10; // limit interruptions of one session before the runner gives up
const MAX_CONTINUES = 3; // runs of one session that end without a commit before the runner gives up

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

function runSession(options, slug, entry, logPath, resume, milestone) {
  const session = entry.id;
  const prompt = entry.format === "yaml"
    ? `/orchestrate ${options.planDir}/plan.yaml session ${session}`
    : `/orchestrate ${options.planDir}/plan.md session ${session}`;
  const system = [UNATTENDED, milestone ? MILESTONE : "", resume ? RESUME : ""].filter(Boolean).join(" ");
  if (milestone) console.log(`[plan] session ${session} is a lint milestone`);
  const args = ["-p", prompt, "--model", options.model, "--permission-mode", options.permissionMode, "--permission-prompts", "none",
    "--output-format", "stream-json", "--verbose", "--append-system-prompt", system];
  if (options.maxBudgetUsd !== null) args.push("--max-budget-usd", String(options.maxBudgetUsd));
  console.log(`[plan] ${slug} session ${session}: claude ${args.slice(0, 6).join(" ")} …`);
  console.log(`[plan] transcript: ${logPath}`);
  return new Promise((resolvePromise) => {
    const env = { ...process.env, LABSHELF_PLAN: slug, LABSHELF_PLAN_SESSION: session };
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

// Where a session stands after a run: "done" (file gone), "blocked" (YAML only) or "pending".
function sessionState(planDir, entry) {
  if (entry.format === "md") return pendingSessions(planDir).some((e) => e.id === entry.id) ? "pending" : "done";
  if (!existsSync(entry.file)) return "done";
  return loadSession(planDir, entry.id).status;
}

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
  for (const s of skipped) console.log(`[plan] skipped ${s.id}: ${s.reason}`);
  const milestones = initial.filter((_, i) => isMilestone(initial.length - i, options.lintEvery));
  console.log(`[plan] lint milestones: ${milestones.map((e) => e.id).join(", ")}`);
  if (options.dryRun) return;
  emit("run_started", { options: { ...options, maxSessions: Number.isFinite(options.maxSessions) ? options.maxSessions : null } });
  if (!options.resume && dirtyTracked()) throw new Error("tracked changes are uncommitted; commit or stash them, or pass --resume to continue the stopped session on top of them");
  ensureBranch(slug);
  const logDir = join(root, ".git", "plan-runs", slug);
  mkdirSync(logDir, { recursive: true });

  const attempts = new Map();
  let ran = 0;
  let resume = options.resume ? initial[0]?.id ?? null : null; // session id interrupted by the usage limit
  const resumes = new Map();
  const continues = new Map();
  const costs = new Map();
  for (;;) {
    const { queue: pending, skipped: left } = planQueue(planDir);
    const [entry] = pending;
    if (!entry) {
      for (const s of left) console.log(`[plan] not run ${s.id}: ${s.reason}`);
      break;
    }
    const session = entry.id;
    if (ran >= options.maxSessions) { console.log(`[plan] stopped after ${ran} sessions (--max-sessions)`); return; }
    if ((attempts.get(session) ?? 0) >= 1) throw new Error(`session ${session} is still pending after a run; read its transcript in ${logDir}`);
    if (resume !== session && dirtyTracked()) throw new Error(`tracked changes are uncommitted before session ${session}`);

    const headBefore = git("rev-parse", "HEAD");
    const started = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    refreshFacts();
    const { code, result, stalled, tail } = await runSession(options, slug, entry, join(logDir, `${session}-${stamp}.jsonl`), resume === session,
      isMilestone(pending.length, options.lintEvery));
    costs.set(session, (costs.get(session) ?? 0) + (result?.total_cost_usd ?? 0));
    const closeEvent = (status) => emit("session_closed", {
      session, status, commits: Number(git("rev-list", "--count", `${headBefore}..HEAD`)), cost_usd: costs.get(session),
    });
    const fail = (message) => { closeEvent("failed"); throw new Error(message); };
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`\n[plan] session ${session} ended in ${minutes} min, exit ${code}` +
      (result?.total_cost_usd ? `, $${result.total_cost_usd.toFixed(2)}` : ""));
    if (result?.result) console.log(result.result.trim().split("\n").map((l) => `  ${l}`).join("\n"));

    const failed = stalled || code !== 0 || !result || result.is_error;
    if (failed && options.wait && (resumes.get(session) ?? 0) < MAX_RESUMES) {
      const hinted = limitRetryAt(tail);
      console.log(`[plan] session ${session} ${stalled ? "stalled" : "failed"}; checking whether Claude is at the usage limit`);
      if (await waitForUsage(options.model, hinted)) {
        resumes.set(session, (resumes.get(session) ?? 0) + 1);
        resume = session;
        continue;
      }
    }
    if (failed) fail(`session ${session} ${stalled ? "stalled" : "failed"} (exit ${code}, ${result?.subtype ?? "no result"}) while Claude answers normally`);
    // A run that ended its turn early (e.g. waiting for background agents) leaves the session pending without a commit.
    const state = sessionState(planDir, entry);
    if (state === "pending" && git("rev-parse", "HEAD") === headBefore && (continues.get(session) ?? 0) < MAX_CONTINUES) {
      continues.set(session, (continues.get(session) ?? 0) + 1);
      console.log(`[plan] session ${session} ended without a commit; continuing it (${continues.get(session)}/${MAX_CONTINUES})`);
      resume = session;
      continue;
    }
    resume = null;
    ran++;
    attempts.set(session, (attempts.get(session) ?? 0) + 1);
    if (dirtyTracked()) fail(`session ${session} left uncommitted tracked changes:\n${dirtyTracked()}`);
    const advanced = git("rev-parse", "HEAD") !== headBefore;
    if (state === "blocked") {
      console.log(`[plan] session ${session} is blocked: ${loadSession(planDir, session).blocked_reason ?? "no reason recorded"}; going on with the sessions that do not depend on it`);
    } else if (!advanced) fail(`session ${session} made no commit`);
    if (advanced) console.log(`[plan] commits: ${git("log", "--oneline", `${headBefore}..HEAD`).split("\n").join(" | ")}\n`);
    closeEvent(state === "blocked" ? "blocked" : state === "done" ? "done" : "failed");
  }
  console.log(`[plan] ${slug}: no sessions left after ${ran} runs.`);
}

main().catch((error) => {
  console.error(`[plan] STOP: ${error.message}`);
  process.exit(1);
});
