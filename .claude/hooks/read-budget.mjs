#!/usr/bin/env node
// Warns the main thread once when its reads of packages/ pass a character budget (PostToolUse hook).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const CHAR_BUDGET = 60_000;
const MESSAGE = `The main thread has read over ${CHAR_BUDGET / 1000}k characters of packages/: delegate further reading of packages/ to an Explore scout and work from its summary.`;

function readState(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { chars: 0, warned: false };
  }
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  // Subagents read freely; only the main thread's context is spent by these reads.
  if (!input.agent_id && JSON.stringify(input.tool_input ?? {}).includes('packages/')) {
    const response = input.tool_response;
    const length = typeof response === 'string' ? response.length : JSON.stringify(response ?? '').length;
    const stateDir = process.env.LABSHELF_BUDGET_STATE_DIR ?? join(tmpdir(), 'labshelf-context-budget');
    // The suffix keeps this file apart from context-budget's `<session>-main.json`.
    const stateFile = join(stateDir, `${input.session_id}-read-budget.json`);
    const state = readState(stateFile);
    state.chars += length;
    const warn = !state.warned && state.chars > CHAR_BUDGET;
    if (warn) state.warned = true;
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(state));
    if (warn) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: MESSAGE } }));
    }
  }
} catch (error) {
  // A budget warning must never fail the tool call.
  process.stderr.write(`read-budget: ${error.message}\n`);
}
