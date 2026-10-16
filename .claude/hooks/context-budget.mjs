#!/usr/bin/env node
// Warns the running agent once when its context passes the token budget (PostToolUse hook).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BUDGETS, latestContext } from '../../scripts/agent-transcripts/index.mjs';

const REWARN_STEP = 40_000;

const MESSAGES = {
  subagent: (k) => `Context ≈${k}k tokens, over the 60k budget: finish the current edit, run no new broad reads, and return your report now with what is left undone.`,
  main: (k) => `Context ≈${k}k tokens, over the 150k budget: avoid new broad reads and delegate what is left of the session; write a new session file only if it cannot finish here.`,
};

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

// Returns the warning to show, or undefined; keeps the context of the last warning in a state file.
function decide(role, context, stateFile) {
  const warnedAt = readWarnedAt(stateFile);
  if (context <= BUDGETS[role]) {
    // Compaction or a fresh start brought the context back under budget, so the next crossing warns again.
    if (warnedAt !== undefined) rmSync(stateFile, { force: true });
    return undefined;
  }
  if (warnedAt !== undefined && context < warnedAt + REWARN_STEP) return undefined;
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ warnedAt: context }));
  return MESSAGES[role](Math.round(context / 1000));
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const role = input.agent_id ? 'subagent' : 'main';
  const context = latestContext(transcriptFor(input));
  if (context !== undefined) {
    const stateDir = process.env.LABSHELF_BUDGET_STATE_DIR ?? join(tmpdir(), 'labshelf-context-budget');
    const stateFile = join(stateDir, `${input.session_id}-${input.agent_id ?? 'main'}.json`);
    const additionalContext = decide(role, context, stateFile);
    if (additionalContext) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
    }
  }
} catch (error) {
  // A budget warning must never fail the tool call.
  process.stderr.write(`context-budget: ${error.message}\n`);
}
