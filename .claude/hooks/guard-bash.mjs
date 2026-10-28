// PreToolUse Bash hook: denies raw test, typecheck and build commands and names the scripts/agents/run.mjs equivalent.
// PLATFORM: raw output floods the context and bypasses the attempt counter; run.mjs prints a short tail and counts attempts.
import { readFileSync } from 'node:fs';

const SCRIPTS = new Set(['test', 'test:tooling', 'typecheck', 'build']);
const RUNNER = 'node scripts/agents/run.mjs';
const VALUE_OPTIONS = new Set(['--filter', '-F', '--dir', '-C']);

// Splits a command into segments at && || ; | and newlines, and each segment into words; quotes group but separators inside them do not split.
function segments(command) {
  const result = [];
  let words = [];
  let word = null;
  let quote = null;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = () => {
    endWord();
    if (words.length) result.push(words);
    words = [];
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (c === '\\' && i + 1 < command.length) {
      word = (word ?? '') + command[++i];
    } else if (/\s/.test(c) && c !== '\n') endWord();
    else if (c === '&' || c === '|' || c === ';' || c === '\n') endSegment();
    else word = (word ?? '') + c;
  }
  endSegment();
  return result;
}

const packageFolder = (filter) => filter.replace(/^@labshelf\//, '');

// Returns the run.mjs equivalent of a raw check in one segment, or null when the segment is fine.
function equivalent(words) {
  let i = 0;
  while (i < words.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]) || ['time', 'exec', 'env'].includes(words[i]))) i++;
  const rest = words.slice(i);
  if (rest.some((word) => word.endsWith('run.mjs'))) return null;
  let [command, ...args] = rest;
  if (command === 'npx' || (command === 'pnpm' && args[0] === 'exec')) {
    [command, ...args] = command === 'npx' ? args : args.slice(1);
    if (command === 'jest') return `${RUNNER} test <pkg> -- ${args.join(' ')}`.trim();
    if (command === 'tsc') return `${RUNNER} typecheck <pkg>`;
    return null;
  }
  if (command === 'jest') return `${RUNNER} test <pkg> -- ${args.join(' ')}`.trim();
  if (command === 'tsc') return `${RUNNER} typecheck <pkg>`;
  if (command === 'node') return args.includes('--test') ? `${RUNNER} test tooling -- <paths>` : null;
  if (command !== 'pnpm') return null;
  let filter = null;
  for (let j = 0; j < args.length; j++) {
    const arg = args[j];
    if (arg.startsWith('--filter=')) filter = packageFolder(arg.slice('--filter='.length));
    else if (VALUE_OPTIONS.has(arg)) {
      if (arg === '--filter' || arg === '-F') filter = packageFolder(args[j + 1] ?? '');
      j++;
    } else if (arg.startsWith('-')) continue;
    else {
      const script = arg === 'run' ? args[j + 1] : arg;
      if (!SCRIPTS.has(script)) return null;
      const tail = args.slice(j + (arg === 'run' ? 2 : 1));
      const forwarded = tail[0] === '--' ? tail.slice(1) : tail;
      const suffix = forwarded.length ? ` -- ${forwarded.join(' ')}` : '';
      if (script === 'typecheck' || script === 'build') return `${RUNNER} ${script} ${filter ?? '<pkg>'}`;
      return `${RUNNER} test ${script === 'test:tooling' ? 'tooling' : (filter ?? '<pkg>')}${suffix}`;
    }
  }
  return null;
}

try {
  const command = JSON.parse(readFileSync(0, 'utf8'))?.tool_input?.command;
  if (typeof command === 'string') {
    for (const words of segments(command)) {
      const replacement = equivalent(words);
      if (replacement) {
        console.log(
          JSON.stringify({
            hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Use: ${replacement}` },
          }),
        );
        break;
      }
    }
  }
} catch {
  // A hook never breaks a session.
}
