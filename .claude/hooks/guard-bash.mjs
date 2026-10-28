// PreToolUse Bash hook: denies raw test/typecheck/build commands, bulk sed/perl rewrites, git mv of code, Bash reads of documents/ and first-time identifier greps, each with the exact replacement command.
// PLATFORM: raw output floods the context and bypasses the attempt counter; the codemods, doc.mjs and facts.mjs give exact answers where sed, cat and grep guess.
import { readFileSync } from 'node:fs';
import { docReadReason, grepReason, openState, recordFacts } from './guard-bash-reads.mjs';
import { gitMoveReason, rewriteReason } from './guard-bash-rewrites.mjs';
import { runnerReason } from './guard-bash-runner.mjs';
import { applyCd, commandsOf } from './guard-bash-shell.mjs';

function denyReason(command, input) {
  const ctx = { cwd: '', text: command, root: (process.env.CLAUDE_PROJECT_DIR ?? process.cwd()).replace(/\/$/, '') };
  const commands = commandsOf(command);
  const state = openState(input);
  for (const cmd of commands) recordFacts(cmd, state);
  for (const cmd of commands) {
    if (cmd.words[0] === 'cd') applyCd(ctx, cmd.words);
    const reason = runnerReason(cmd.words) ?? rewriteReason(cmd, ctx) ?? gitMoveReason(cmd, ctx) ?? docReadReason(cmd, ctx) ?? grepReason(cmd, ctx, state);
    if (reason) return reason;
  }
  return null;
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const command = input?.tool_input?.command;
  const reason = typeof command === 'string' ? denyReason(command, input) : null;
  if (reason) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
} catch {
  // A hook never breaks a session.
}
