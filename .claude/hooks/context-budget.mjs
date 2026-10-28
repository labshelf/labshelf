#!/usr/bin/env node
// Warns the running agent once when its context passes the token budget (PostToolUse hook).
// In an unattended plan session (runPlan.mjs sets LABSHELF_PLAN and LABSHELF_PLAN_SESSION) the main thread is instead
// checked before each tool call (PreToolUse hook), in three stages:
// - past LABSHELF_MAIN_CONTEXT_WARN (or the older LABSHELF_MAIN_CONTEXT_STOP; default 100k) a warning, on crossing and
//   every 20k after, to weigh what is left and either finish here or hand off;
// - past LABSHELF_MAIN_CONTEXT_HARD (default 150k) calls that start new work are denied (an implementer, tester or
//   diagnoser agent, `plan.mjs start|prompt`); report routing, the finisher, `plan close` and plan edits still pass;
// - past LABSHELF_MAIN_CONTEXT_KILL (default 190k) any tool call ends the session, as a last resort.
// The first warning writes the file LABSHELF_BUDGET_STOP_FILE names, so a session that hands off and ends pending is
// run again in a fresh process when it made progress (runPlan.mjs); a session that finishes leaves the marker unused.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

// Token budget by agent type; the main thread has no agent_id, any other subagent type gets the default.
const BUDGETS = { main: 150_000, explorer: 100_000 };
const DEFAULT_SUBAGENT_BUDGET = 60_000;
const REWARN_STEP = 40_000;
const TAIL_BYTES = 256 * 1024;
const MAIN_WARN = 100_000;
const MAIN_HARD = 150_000;
const MAIN_KILL = 190_000;
const MAIN_REWARN_STEP = 20_000;
// Agents that start a new package (tests, code, a diagnosis) rather than finish one in flight.
const NEW_WORK_AGENTS = new Set(['implementer', 'tester', 'diagnoser']);
const NEW_WORK_COMMAND = /scripts\/plans\/plan\.mjs\s+(start|prompt)\b/;

const MESSAGES = {
  subagent: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k budget: finish the current edit, run no new broad reads, and return your report now with what is left undone.`,
  main: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k budget: avoid new broad reads and delegate what is left of the session; write a new session file only if it cannot finish here.`,
  warn: (k, limit, hard) =>
    `Context ≈${k}k tokens, over the ${limit / 1000}k warning of an unattended session; from ${hard / 1000}k new packages are denied. Weigh what is left: finish here if it is little, else hand off (record the packages not yet started as pending in the session file, finish what is in flight, end the turn; the runner reopens the session).`,
  deny: (k, limit) =>
    `Context ≈${k}k tokens, over the ${limit / 1000}k limit of an unattended session: start no new package. Record the packages not yet started as pending in the session file, finish what is in flight (route open reports, \`finish session\` if every started package is done, \`plan close\`), then end the turn. The runner reopens the session for the rest.`,
  kill: (k, limit) =>
    `Context ≈${k}k tokens, over the ${limit / 1000}k last-resort ceiling of an unattended session: the session is ended here. The runner reopens it in a fresh process.`,
};

// Context tokens an agent carries into a turn: everything the API read or cached for it.
const contextOf = (usage) => (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);

// Returns the context size of the last assistant turn in the transcript's tail, without parsing the whole file.
function latestContext(path) {
  const fd = openSync(path, 'r');
  try {
    const { size } = fstatSync(fd);
    const start = Math.max(0, size - TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n');
    // The first line of a mid-file tail is cut off; only a tail that starts at byte 0 keeps it.
    if (start > 0) lines.shift();
    for (const line of lines.reverse()) {
      if (!line.includes('"cache_read_input_tokens"') || !line.includes('"type":"assistant"')) continue;
      try {
        const usage = JSON.parse(line).message?.usage;
        if (usage) return contextOf(usage);
      } catch {
        // A line still being written is skipped; the previous turn answers instead.
      }
    }
    return undefined;
  } finally {
    closeSync(fd);
  }
}

function transcriptFor(input) {
  if (!input.agent_id) return input.transcript_path;
  const sessionDir = join(dirname(input.transcript_path), input.session_id);
  return join(sessionDir, 'subagents', `agent-${input.agent_id}.jsonl`);
}

function readWarnedAt(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).warnedAt;
  } catch {
    return undefined;
  }
}

const budgetFor = (agentType) => BUDGETS[agentType] ?? DEFAULT_SUBAGENT_BUDGET;

// Returns the warning to show, or undefined; keeps the context of the last warning in a state file.
function decide(role, budget, context, stateFile) {
  const warnedAt = readWarnedAt(stateFile);
  if (context <= budget) {
    // Compaction or a fresh start brought the context back under budget, so the next crossing warns again.
    if (warnedAt !== undefined) rmSync(stateFile, { force: true });
    return undefined;
  }
  if (warnedAt !== undefined && context < warnedAt + REWARN_STEP) return undefined;
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ warnedAt: context }));
  return MESSAGES[role](Math.round(context / 1000), budget);
}

const unattended = () => Boolean(process.env.LABSHELF_PLAN && process.env.LABSHELF_PLAN_SESSION);
const limit = (name, fallback) => Number(process.env[name]) || fallback;
const warnLimit = () => Number(process.env.LABSHELF_MAIN_CONTEXT_WARN) || limit('LABSHELF_MAIN_CONTEXT_STOP', MAIN_WARN);

function startsNewWork({ tool_name: tool, tool_input: args = {} }) {
  if (tool === 'Agent' || tool === 'Task') return NEW_WORK_AGENTS.has(args.subagent_type);
  if (tool === 'Bash') return NEW_WORK_COMMAND.test(String(args.command ?? ''));
  return false;
}

function writeMarker(input, context, limit) {
  const marker = process.env.LABSHELF_BUDGET_STOP_FILE;
  if (!marker || existsSync(marker)) return;
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, JSON.stringify({ session_id: input.session_id, context_tokens: context, limit }));
}

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

// PreToolUse output for an unattended main thread, or undefined: a warning past the warn limit (on crossing, then every
// MAIN_REWARN_STEP), a deny for a call that starts new work past the hard limit, the end of the session past the kill one.
function boundaryDecision(input, context, stateFile) {
  const warn = warnLimit();
  const hard = limit('LABSHELF_MAIN_CONTEXT_HARD', MAIN_HARD);
  const kill = limit('LABSHELF_MAIN_CONTEXT_KILL', MAIN_KILL);
  const k = Math.round(context / 1000);
  if (context <= warn) {
    // Compaction or a fresh start brought the context back under the limit, so the next crossing warns again.
    rmSync(stateFile, { force: true });
    return undefined;
  }
  const stopEvent = (budget) => emit('budget_stop', { agent_type: 'main', session_id: input.session_id, context_tokens: context, budget });
  writeMarker(input, context, warn);
  if (context > kill) {
    stopEvent(kill);
    return { continue: false, stopReason: MESSAGES.kill(k, kill) };
  }
  const state = readState(stateFile);
  const save = (next) => {
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ ...state, ...next }));
  };
  if (context > hard && startsNewWork(input)) {
    if (!state.denied) stopEvent(hard);
    save({ denied: true });
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: MESSAGES.deny(k, hard) } };
  }
  if (state.warnedAt !== undefined && context < state.warnedAt + MAIN_REWARN_STEP) return undefined;
  if (state.warnedAt === undefined) emit('budget_warning', { agent_type: 'main', session_id: input.session_id, context_tokens: context, budget: warn });
  save({ warnedAt: context });
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: MESSAGES.warn(k, warn, hard) } };
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const role = input.agent_id ? 'subagent' : 'main';
  const agentType = input.agent_id ? input.agent_type : 'main';
  const budget = budgetFor(agentType);
  const stateDir = process.env.LABSHELF_BUDGET_STATE_DIR ?? join(tmpdir(), 'labshelf-context-budget');
  // A session whose id is a file in <stateDir>/off gets no warnings, its subagents included (benchmark and test sessions).
  const off = existsSync(join(stateDir, 'off', input.session_id));
  const context = off ? undefined : latestContext(transcriptFor(input));
  const pre = input.hook_event_name === 'PreToolUse';
  if (role === 'main' && unattended()) {
    // The unattended main thread is checked before each call (PreToolUse) and gets no budget warning after it.
    const output = context !== undefined && pre && boundaryDecision(input, context, join(stateDir, `${input.session_id}-main-stop.json`));
    if (output) process.stdout.write(JSON.stringify(output));
  } else if (context !== undefined && !pre) {
    const stateFile = join(stateDir, `${input.session_id}-${input.agent_id ?? 'main'}.json`);
    const additionalContext = decide(role, budget, context, stateFile);
    if (additionalContext) {
      emit('budget_warning', { agent_type: agentType ?? null, session_id: input.session_id, context_tokens: context, budget });
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
    }
  }
} catch (error) {
  // A budget warning must never fail the tool call.
  process.stderr.write(`context-budget: ${error.message}\n`);
}
