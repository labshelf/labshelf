#!/usr/bin/env node
// Warns the running agent when its context grows large (PostToolUse hook). A context size is only ever a warning,
// never a stop: models degrade past ~100k tokens, so the warnings push the agent to wrap up, but it must always be
// able to finish what is in flight and return its report.
// - A subagent of any type is warned past 80k tokens, on crossing and every 20k after: no new broad reads, finish the
//   work in flight, then return the report with what is left undone.
// - In an unattended plan session (runPlan.mjs sets LABSHELF_PLAN and LABSHELF_PLAN_SESSION) the main thread is instead
//   checked before each tool call (PreToolUse hook): past LABSHELF_MAIN_CONTEXT_WARN (or the older
//   LABSHELF_MAIN_CONTEXT_STOP; default 100k) it is warned on crossing and every 20k after, to weigh what is left and
//   either finish here or hand off. Nothing is denied and the session is never ended, however large the context.
// The first main-thread warning writes the file LABSHELF_BUDGET_WARN_FILE names (`.budget-warn.json` in the run folder),
// so a session that hands off and ends pending is run again in a fresh process when it made progress (runPlan.mjs); a
// session that finishes leaves the marker unused.
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

// Warning threshold of the attended main thread (it has no agent_id); every subagent type shares one threshold.
const MAIN_BUDGET = 100_000;
const MAIN_STEP = 20_000;
const SUBAGENT_WARN = 80_000;
const SUBAGENT_STEP = 20_000;
const TAIL_BYTES = 256 * 1024;
const UNATTENDED_WARN = 100_000;
const UNATTENDED_STEP = 20_000;

const MESSAGES = {
  subagent: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k warning: your context is large. Do not start new broad reads. Finish the work in flight (including the deterministic scripts, edits and test runs needed to finish it), then return your report with what is left undone.`,
  main: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k budget: avoid new broad reads and delegate what is left of the session; write a new session file only if it cannot finish here.`,
  warn: (k, limit) =>
    `Context ≈${k}k tokens, over the ${limit / 1000}k warning of an unattended session; quality degrades as it grows. Weigh what is left: if much is left, hand off (record the packages not yet started as pending in the session file, finish what is in flight, end the turn; the runner reopens the session); if little is left, finish here.`,
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

const thresholdFor = (role) => (role === 'main' ? { budget: MAIN_BUDGET, step: MAIN_STEP } : { budget: SUBAGENT_WARN, step: SUBAGENT_STEP });

// Returns the warning to show, or undefined; keeps the context of the last warning in a state file.
function decide(role, { budget, step }, context, stateFile) {
  const warnedAt = readWarnedAt(stateFile);
  if (context <= budget) {
    // Compaction or a fresh start brought the context back under budget, so the next crossing warns again.
    if (warnedAt !== undefined) rmSync(stateFile, { force: true });
    return undefined;
  }
  if (warnedAt !== undefined && context < warnedAt + step) return undefined;
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ warnedAt: context }));
  return MESSAGES[role](Math.round(context / 1000), budget);
}

const unattended = () => Boolean(process.env.LABSHELF_PLAN && process.env.LABSHELF_PLAN_SESSION);
const warnLimit = () => Number(process.env.LABSHELF_MAIN_CONTEXT_WARN) || Number(process.env.LABSHELF_MAIN_CONTEXT_STOP) || UNATTENDED_WARN;

function writeMarker(input, context, limit) {
  const marker = process.env.LABSHELF_BUDGET_WARN_FILE;
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

// PreToolUse output for an unattended main thread, or undefined: a warning past the warn limit, on crossing and then
// every UNATTENDED_STEP. It never denies a call or ends the session.
function boundaryDecision(input, context, stateFile) {
  const warn = warnLimit();
  if (context <= warn) {
    // Compaction or a fresh start brought the context back under the limit, so the next crossing warns again.
    rmSync(stateFile, { force: true });
    return undefined;
  }
  writeMarker(input, context, warn);
  const { warnedAt } = readState(stateFile);
  if (warnedAt !== undefined && context < warnedAt + UNATTENDED_STEP) return undefined;
  if (warnedAt === undefined) emit('budget_warning', { agent_type: 'main', session_id: input.session_id, context_tokens: context, budget: warn });
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ warnedAt: context }));
  return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: MESSAGES.warn(Math.round(context / 1000), warn) } };
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const role = input.agent_id ? 'subagent' : 'main';
  const agentType = input.agent_id ? input.agent_type : 'main';
  const threshold = thresholdFor(role);
  const stateDir = process.env.LABSHELF_BUDGET_STATE_DIR ?? join(tmpdir(), 'labshelf-context-budget');
  // A session whose id is a file in <stateDir>/off gets no warnings, its subagents included (benchmark and test sessions).
  const off = existsSync(join(stateDir, 'off', input.session_id));
  const context = off ? undefined : latestContext(transcriptFor(input));
  const pre = input.hook_event_name === 'PreToolUse';
  if (role === 'main' && unattended()) {
    // The unattended main thread is checked before each call (PreToolUse) and gets no budget warning after it.
    const output = context !== undefined && pre && boundaryDecision(input, context, join(stateDir, `${input.session_id}-main-warn.json`));
    if (output) process.stdout.write(JSON.stringify(output));
  } else if (context !== undefined && !pre) {
    const stateFile = join(stateDir, `${input.session_id}-${input.agent_id ?? 'main'}.json`);
    const additionalContext = decide(role, threshold, context, stateFile);
    if (additionalContext) {
      emit('budget_warning', { agent_type: agentType ?? null, session_id: input.session_id, context_tokens: context, budget: threshold.budget });
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
    }
  }
} catch (error) {
  // A budget warning must never fail the tool call.
  process.stderr.write(`context-budget: ${error.message}\n`);
}
