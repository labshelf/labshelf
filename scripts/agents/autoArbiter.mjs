// The automatic arbiter round run.mjs starts when a spec's test runs stall: runs the arbiter headless (`claude --agent arbiter -p`),
// validates its verdict/v1, saves it, and routes it back to the same implementer (code_wrong: neutral evidence and a fresh budget;
// test_wrong: the tester fixes the tests headless, then a fresh budget; spec_ambiguous, a failure or a third stall: BLOCKED).
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { stringify } from "yaml";
import { findSpec } from "../plans/planFiles.mjs";
import { parseBlocks, validate } from "./schemas.mjs";
import { emit } from "./telemetry.mjs";

export const ARBITER_EXIT = 4;
export const MAX_ROUNDS = 2;
// The implementer's Bash call that hits a stall runs no test, only the arbiter and possibly the tester. Each child is capped so the
// whole run.mjs call stays under ~9 minutes (5 + 3.5 min), below the 10 min Bash ceiling. LABSHELF_AGENT_TIMEOUT_MS overrides both.
const ARBITER_TIMEOUT_MS = 5 * 60 * 1000;
const TESTER_TIMEOUT_MS = 3.5 * 60 * 1000;
const QUOTE_RUN = 20;
const WITHHELD = "(withheld: quoted the test)";
const MAX_EVIDENCE = 8;
const WIDTH = 200;

const clip = (text) => (text.length > WIDTH ? `${text.slice(0, WIDTH - 1)}…` : text);
const norm = (text) => String(text).replace(/\s+/g, " ").trim();
const pathsOf = (list) => (Array.isArray(list) ? list.map((entry) => (typeof entry === "string" ? entry : entry?.path)).filter((p) => typeof p === "string") : []);

/** The session file of `plan` that holds package `specId`: LABSHELF_PLAN_SESSION when set, else the first session listing it. */
function locateSpec(root, plan, specId) {
  const planDir = join(root, "documents", "plans", plan);
  const fromEnv = process.env.LABSHELF_PLAN_SESSION;
  const sessionsDir = join(planDir, "sessions");
  const ids = fromEnv ? [fromEnv] : existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => f.endsWith(".yaml")).map((f) => f.slice(0, -5)) : [];
  for (const id of ids) {
    try {
      const spec = findSpec(planDir, id, specId);
      return { ...spec, plan: spec.plan ?? plan };
    } catch {
      /* not in this session */
    }
  }
  throw new Error(`spec ${specId} not found in the sessions of plan ${plan}`);
}

const specBlock = (spec) => ["```yaml spec/v1", stringify({ schema: "spec/v1", ...spec }, { lineWidth: 0 }).trimEnd(), "```"].join("\n");

/** The spec's test files that exist: the documents/plans/<slug>/tests/<id>/ originals and their in-place copies. */
function testTexts(root, spec) {
  const prefix = `documents/plans/${spec.plan}/tests/${spec.id}/`;
  const hidden = pathsOf(spec.tests?.hidden);
  const copies = hidden.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length));
  return [...hidden, ...copies].map((p) => join(root, p)).filter((f) => existsSync(f)).map((f) => norm(readFileSync(f, "utf8")));
}

/** Whether `text` holds a run of 20+ characters (whitespace-normalised) that also occurs in one of `tests`. */
export function quotesTest(text, tests) {
  const t = norm(text);
  for (let i = 0; i + QUOTE_RUN <= t.length; i += 1) {
    const window = t.slice(i, i + QUOTE_RUN);
    if (tests.some((body) => body.includes(window))) return true;
  }
  return false;
}

/** Runs `claude --agent <role> -p <prompt>` headless as that role (LABSHELF_ROLE, no LABSHELF_PLAN_SESSION); returns the final text. */
function runAgent(role, prompt, { root, spawn, specId, timeout }) {
  const { LABSHELF_PLAN_SESSION: _session, ...base } = process.env;
  const env = { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1", ...base, LABSHELF_ROLE: role, LABSHELF_AGENT_TYPE: role, LABSHELF_SPEC: String(specId) };
  const permission = process.env.LABSHELF_AGENT_PERMISSION_MODE || "auto";
  const args = ["-p", prompt, "--agent", role, "--output-format", "json", "--permission-mode", permission, "--permission-prompts", "none", "--no-session-persistence"];
  const result = spawn("claude", args, { cwd: root, env, timeout: Number(process.env.LABSHELF_AGENT_TIMEOUT_MS) || timeout, killSignal: "SIGKILL" });
  if (result.error?.code === "ETIMEDOUT" || result.signal) throw new Error(`${role} timed out`);
  if (result.error) throw new Error(`${role} did not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${role} exited ${result.status}`);
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`${role} printed no JSON result`);
  }
  if (json.is_error || typeof json.result !== "string") throw new Error(`${role} ended in an error`);
  return json.result;
}

function arbiterPrompt(spec, { reason, logFile }) {
  return [
    `run.mjs called you: the implementer's runs of \`${spec.tests?.command ?? "(no tests.command)"}\` for spec ${spec.id} of plan ${spec.plan} stalled (${reason}).`,
    "",
    specBlock(spec),
    "",
    `Tests (tests.hidden): ${pathsOf(spec.tests?.hidden).join(", ") || "(none)"}`,
    `Test command: ${spec.tests?.command ?? "(none)"}`,
    `Last test log: ${logFile ?? "(none recorded)"}`,
    "Read the change with `git diff --stat`, then `git diff -- <path>` for the files the failures touch.",
    "",
    "Return verdict/v1.",
  ].join("\n");
}

function readVerdict(text, specId) {
  const value = parseBlocks(text).verdict;
  if (value === undefined) throw new Error("no verdict/v1 block");
  const errors = validate("verdict", value);
  if (errors.length) throw new Error(`invalid verdict: ${errors[0]}`);
  if (String(value.spec) !== String(specId)) throw new Error(`verdict for spec ${value.spec}, expected ${specId}`);
  return value;
}

function testerFixed(text) {
  const report = parseBlocks(text).report;
  return report !== undefined && !validate("report", report).length && report.status === "done";
}

const rounds = (stateFile) => {
  const dir = dirname(stateFile);
  const name = basename(stateFile);
  const stem = name.replace(/\.json$/, "");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  return {
    resets: files.filter((f) => f.startsWith(`${name}.`) && /^\d+$/.test(f.slice(name.length + 1))).length,
    verdicts: files.filter((f) => new RegExp(`^${stem.replace(/[.]/g, "\\.")}\\.verdict-\\d+\\.yaml$`).test(f)).length,
    file: (n) => join(dir, `${stem}.verdict-${n}.yaml`),
  };
};

const questionLines = (verdict) => String(verdict?.question ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => clip(`  question: ${l}`));

/**
 * The automatic arbiter round for a stalled spec. `ctx`: root, plan, spec (id), stateFile, reason, blockedLine, logFile, out, spawn.
 * Returns the exit code: ARBITER_EXIT when the implementer continues, 3 (BLOCKED) otherwise.
 */
export function arbiterRound(ctx) {
  const { root, plan, out, stateFile, blockedLine } = ctx;
  const specId = ctx.spec;
  const spawn = ctx.spawn ?? ((command, args, options) => spawnSync(command, args, { encoding: "utf8", maxBuffer: 1 << 28, ...options }));
  const blocked = (extra = []) => {
    out(blockedLine);
    for (const line of extra) out(line);
    return 3;
  };
  const state = rounds(stateFile);
  if (state.verdicts > state.resets) {
    // A verdict already left this round open (spec_ambiguous or a failed tester): the orchestrator decides.
    const last = readFileSync(state.file(state.verdicts), "utf8");
    return blocked(questionLines(parseBlocks(last).verdict));
  }
  if (state.resets >= MAX_ROUNDS) return blocked([`(${MAX_ROUNDS} automatic arbiter rounds already used for ${specId})`]);

  const round = state.verdicts + 1;
  let spec;
  let verdict;
  try {
    spec = locateSpec(root, plan, specId);
    verdict = readVerdict(runAgent("arbiter", arbiterPrompt(spec, ctx), { root, spawn, specId, timeout: ARBITER_TIMEOUT_MS }), specId);
  } catch (error) {
    emit("arbiter_failed", { plan, spec: specId, round, error: error.message });
    return blocked([clip(`(automatic arbiter failed: ${error.message})`)]);
  }
  const verdictText = ["```yaml verdict/v1", stringify(verdict, { lineWidth: 0 }).trimEnd(), "```"].join("\n");
  writeFileSync(state.file(round), stringify(verdict, { lineWidth: 0 }));
  emit("arbiter_verdict", { plan, spec: specId, round, verdict: verdict.verdict, evidence: verdict.evidence.length, auto: true });

  const reset = () => renameSync(stateFile, `${stateFile}.${state.resets + 1}`);
  if (verdict.verdict === "code_wrong") {
    const tests = testTexts(root, spec);
    const neutral = (text) => (quotesTest(text, tests) ? WITHHELD : norm(text));
    out(`ARBITER: code_wrong (round ${round} of ${MAX_ROUNDS}): the code departs from the spec`);
    for (const e of verdict.evidence.slice(0, MAX_EVIDENCE)) {
      out(clip(`- ${norm(e.test)} [${norm(e.spec_ref)}]`));
      out(clip(`  ${neutral(e.reason)}`));
    }
    if (verdict.evidence.length > MAX_EVIDENCE) out(`… ${verdict.evidence.length - MAX_EVIDENCE} more evidence entries in ${state.file(round)}`);
    if (verdict.hint) out(clip(`hint: ${neutral(verdict.hint)}`));
    reset();
    out(`Keep working on spec ${specId} in this same package: change the code as the spec asks, then run the same test command again (fresh budget of test runs).`);
    return ARBITER_EXIT;
  }
  if (verdict.verdict === "test_wrong") {
    const prompt = [specBlock(spec), "", verdictText, "", "Fix the tests as the verdict's fix says, then return report/v1."].join("\n");
    try {
      if (!testerFixed(runAgent("tester", prompt, { root, spawn, specId, timeout: TESTER_TIMEOUT_MS }))) throw new Error("tester did not return report/v1 with status done");
    } catch (error) {
      emit("arbiter_failed", { plan, spec: specId, round, error: error.message });
      return blocked([clip(`(test_wrong, but the automatic tester failed: ${error.message})`)]);
    }
    emit("test_fixed", { plan, spec: specId, round, auto: true });
    reset();
    out("ARBITER: test_wrong — the tests were corrected; run the same test command again");
    out(`Keep working on spec ${specId} in this same package (fresh budget of test runs).`);
    return ARBITER_EXIT;
  }
  return blocked([`ARBITER: spec_ambiguous (round ${round})`, ...questionLines(verdict)]);
}
