#!/usr/bin/env node
// Warns the running agent once when its context passes the token budget (PostToolUse hook).
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { emit } from '../../scripts/agents/telemetry.mjs';

// Token budget by agent type; the main thread has no agent_id, any other subagent type gets the default.
const BUDGETS = { main: 150_000, explorer: 100_000 };
const DEFAULT_SUBAGENT_BUDGET = 60_000;
const REWARN_STEP = 40_000;
const TAIL_BYTES = 256 * 1024;

const MESSAGES = {
  subagent: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k budget: finish the current edit, run no new broad reads, and return your report now with what is left undone.`,
  main: (k, budget) => `Context ≈${k}k tokens, over the ${budget / 1000}k budget: avoid new broad reads and delegate what is left of the session; write a new session file only if it cannot finish here.`,
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

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const role = input.agent_id ? 'subagent' : 'main';
  const agentType = input.agent_id ? input.agent_type : 'main';
  const budget = budgetFor(agentType);
  const stateDir = process.env.LABSHELF_BUDGET_STATE_DIR ?? join(tmpdir(), 'labshelf-context-budget');
  // A session whose id is a file in <stateDir>/off gets no warnings, its subagents included (benchmark and test sessions).
  const off = existsSync(join(stateDir, 'off', input.session_id));
  const context = off ? undefined : latestContext(transcriptFor(input));
  if (context !== undefined) {
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
