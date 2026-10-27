// Runs every session of an approved plan unattended, one fresh headless Claude process per session, so each session
// starts with an empty context. Stops at the first session that fails, leaves the tree dirty or makes no progress.
// Usage: node scripts/plans/runPlan.mjs documents/plans/<slug> [--model opus] [--permission-mode auto]
//        [--max-sessions N] [--dry-run]
// Logs: .git/plan-runs/<slug>/<session>-<time>.jsonl (the stream-json transcript of each session).
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { createInterface } from "node:readline";

const root = resolve(import.meta.dirname, "..", "..");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

function parseArgs(argv) {
  const options = { model: "opus", permissionMode: "auto", maxSessions: Infinity, dryRun: false, planDir: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--model") options.model = argv[++i];
    else if (arg === "--permission-mode") options.permissionMode = argv[++i];
    else if (arg === "--max-sessions") options.maxSessions = Number(argv[++i]);
    else if (arg === "--dry-run") options.dryRun = true;
    else if (!options.planDir) options.planDir = arg.replace(/\/+$/, "");
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!options.planDir) throw new Error("usage: node scripts/plans/runPlan.mjs documents/plans/<slug> [options]");
  return options;
}

// Session files sort by their numeric prefix, then by suffix: 2.md < 10.md < 10a.md < 10b.md < 10-rest.md.
function pendingSessions(sessionsDir) {
  if (!existsSync(sessionsDir)) return [];
  const key = (name) => {
    const match = /^(\d+)(.*)\.md$/.exec(name);
    return match ? [Number(match[1]), match[2]] : [Infinity, name];
  };
  return readdirSync(sessionsDir)
    .filter((name) => name.endsWith(".md"))
    .sort((a, b) => {
      const [na, sa] = key(a), [nb, sb] = key(b);
      return na - nb || sa.localeCompare(sb);
    })
    .map((name) => name.slice(0, -3));
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

const UNATTENDED = [
  "You are running unattended from scripts/plans/runPlan.mjs: nobody reads this conversation until it ends and nobody",
  "answers questions. Never ask the user; apply the session file's decisions, and where it is silent pick the option",
  "that keeps current behaviour and note it in the handoff. The approved plan authorises the session's commits.",
  "If the session cannot finish, write the remainder as sessions/<id>-<name>.md as the handoff reference says,",
  "commit what is done, and stop. Never leave tracked changes uncommitted.",
].join(" ");

function runSession(options, slug, session, logPath) {
  const prompt = `/orchestrate ${options.planDir}/plan.md session ${session}`;
  const args = ["-p", prompt, "--model", options.model, "--permission-mode", options.permissionMode,
    "--output-format", "stream-json", "--verbose", "--append-system-prompt", UNATTENDED];
  console.log(`[plan] ${slug} session ${session}: claude ${args.slice(0, 6).join(" ")} …`);
  console.log(`[plan] transcript: ${logPath}`);
  return new Promise((resolvePromise) => {
    const child = spawn("claude", args, { cwd: root, stdio: ["ignore", "pipe", "inherit"] });
    const log = createWriteStream(logPath);
    let result = null;
    const onSignal = () => child.kill("SIGINT");
    process.on("SIGINT", onSignal);
    createInterface({ input: child.stdout }).on("line", (line) => {
      log.write(`${line}\n`);
      let event;
      try { event = JSON.parse(line); } catch { return; }
      if (event.type === "result") result = event;
      if (event.type === "assistant") {
        for (const part of event.message?.content ?? []) {
          if (part.type === "text" && part.text.trim()) console.log(`  │ ${part.text.trim().split("\n")[0].slice(0, 160)}`);
          if (part.type === "tool_use" && part.name === "Agent") console.log(`  │ → agent: ${part.input?.description ?? ""}`);
        }
      }
    });
    child.on("close", (code) => {
      process.off("SIGINT", onSignal);
      log.end();
      resolvePromise({ code, result });
    });
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const planDir = resolve(root, options.planDir);
  const slug = basename(planDir);
  const sessionsDir = join(planDir, "sessions");
  const planFile = join(planDir, "plan.md");
  if (!existsSync(planFile)) throw new Error(`no plan at ${options.planDir}/plan.md`);
  const status = /^Status:\s*(.+)$/m.exec(readFileSync(planFile, "utf8"))?.[1]?.trim() ?? "";
  if (!/^(approved|in progress)/.test(status)) throw new Error(`plan status is "${status}"; approve it first`);
  const queue = pendingSessions(sessionsDir);
  console.log(`[plan] ${slug}: ${queue.length} sessions pending: ${queue.join(", ")}`);
  if (options.dryRun) return;
  if (dirtyTracked()) throw new Error("tracked changes are uncommitted; commit or stash them first");
  ensureBranch(slug);
  const logDir = join(root, ".git", "plan-runs", slug);
  mkdirSync(logDir, { recursive: true });

  const attempts = new Map();
  let ran = 0;
  for (;;) {
    const [session] = pendingSessions(sessionsDir);
    if (!session) break;
    if (ran >= options.maxSessions) { console.log(`[plan] stopped after ${ran} sessions (--max-sessions)`); return; }
    if ((attempts.get(session) ?? 0) >= 1) throw new Error(`session ${session} is still pending after a run; read its transcript in ${logDir}`);
    attempts.set(session, (attempts.get(session) ?? 0) + 1);

    const headBefore = git("rev-parse", "HEAD");
    const started = Date.now();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const { code, result } = await runSession(options, slug, session, join(logDir, `${session}-${stamp}.jsonl`));
    ran++;
    const minutes = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`\n[plan] session ${session} ended in ${minutes} min, exit ${code}` +
      (result?.total_cost_usd ? `, $${result.total_cost_usd.toFixed(2)}` : ""));
    if (result?.result) console.log(result.result.trim().split("\n").map((l) => `  ${l}`).join("\n"));

    if (code !== 0 || !result || result.is_error) throw new Error(`session ${session} failed (exit ${code}, ${result?.subtype ?? "no result"})`);
    if (dirtyTracked()) throw new Error(`session ${session} left uncommitted tracked changes:\n${dirtyTracked()}`);
    const advanced = git("rev-parse", "HEAD") !== headBefore;
    if (!advanced) throw new Error(`session ${session} made no commit`);
    console.log(`[plan] commits: ${git("log", "--oneline", `${headBefore}..HEAD`).split("\n").join(" | ")}\n`);
  }
  console.log(`[plan] ${slug}: no sessions left after ${ran} runs.`);
}

main().catch((error) => {
  console.error(`[plan] STOP: ${error.message}`);
  process.exit(1);
});
