// Maps a raw test, typecheck or build command to its scripts/agents/run.mjs equivalent for the guard-bash hook.
import { skipOptions } from './guard-bash-shell.mjs';

const SCRIPTS = new Set(['test', 'test:tooling', 'typecheck', 'build']);
const RUNNER = 'node scripts/agents/run.mjs';
const VALUE_OPTIONS = new Set(['--filter', '-F', '--dir', '-C', '--prefix', '--workspace']);
const EXEC_VALUED = new Set(['-p', '--package', '-c']);
const PACKAGE_RUNNERS = new Set(['pnpm', 'npm', 'yarn']);
const EXEC_RUNNERS = new Set(['npx', 'pnpx', 'bunx']);
const EXEC_VERBS = new Set(['exec', 'dlx', 'x']);
const TOOL_KIND = { jest: 'test', vitest: 'test', tsc: 'typecheck' };
const TOOL_BIN = /(?:^|\/)node_modules\/(?:\.bin|[^/]+\/bin)\/(jest|vitest|tsc)(?:\.[cm]?js)?$/;

const packageFolder = (filter) => filter.replace(/^@labshelf\//, '');
const toolOf = (word) => (Object.hasOwn(TOOL_KIND, word) ? word : (TOOL_BIN.exec(word)?.[1] ?? null));

function toolCommand(word, args, pkg) {
  const tool = toolOf(word);
  if (!tool) return null;
  if (TOOL_KIND[tool] === 'typecheck') return `${RUNNER} typecheck ${pkg || '<pkg>'}`;
  return `${RUNNER} test ${pkg || '<pkg>'}${args.length ? ` -- ${args.join(' ')}` : ''}`;
}

function execTool(args, pkg) {
  const rest = skipOptions(args, EXEC_VALUED);
  return toolCommand(rest[0] ?? '', rest.slice(1), pkg);
}

function scriptCommand(script, tail, filter) {
  if (!SCRIPTS.has(script)) return null;
  const forwarded = tail[0] === '--' ? tail.slice(1) : tail;
  if (script === 'typecheck' || script === 'build') return `${RUNNER} ${script} ${filter || '<pkg>'}`;
  return `${RUNNER} test ${script === 'test:tooling' ? 'tooling' : filter || '<pkg>'}${forwarded.length ? ` -- ${forwarded.join(' ')}` : ''}`;
}

function packageCommand(name, args) {
  let filter = null;
  for (let j = 0; j < args.length; j++) {
    const arg = args[j];
    if (arg.startsWith('--filter=')) filter = packageFolder(arg.slice('--filter='.length));
    else if (VALUE_OPTIONS.has(arg)) {
      if (arg === '--filter' || arg === '-F') filter = packageFolder(args[j + 1] ?? '');
      j++;
    } else if (arg.startsWith('-')) continue;
    else if (name === 'yarn' && arg === 'workspace') filter = packageFolder(args[++j] ?? '');
    else if (EXEC_VERBS.has(arg)) return execTool(args.slice(j + 1), filter);
    else if (toolOf(arg)) return toolCommand(arg, args.slice(j + 1), filter);
    else if (arg === 'run' || arg === 'run-script') {
      const tail = args.slice(j + 1);
      const at = tail.findIndex((word) => !word.startsWith('-'));
      return at < 0 ? null : scriptCommand(tail[at], tail.slice(at + 1), filter);
    } else return scriptCommand(name === 'npm' && arg === 't' ? 'test' : arg, args.slice(j + 1), filter);
  }
  return null;
}

function nodeCommand(args) {
  if (args.includes('--test')) return `${RUNNER} test tooling -- <paths>`;
  const at = args.findIndex((arg) => !arg.startsWith('-'));
  return at < 0 ? null : toolCommand(args[at], args.slice(at + 1), null);
}

// Returns the deny reason naming the run.mjs equivalent of a raw check, or null when the command is fine.
export function runnerReason(words) {
  if (words.some((word) => word.endsWith('run.mjs'))) return null;
  const [command, ...args] = words;
  let equivalent;
  if (EXEC_RUNNERS.has(command)) equivalent = execTool(args, null);
  else if (PACKAGE_RUNNERS.has(command)) equivalent = packageCommand(command, args);
  else if (command === 'node') equivalent = nodeCommand(args);
  else equivalent = toolCommand(command, args, null);
  return equivalent ? `Use: ${equivalent}` : null;
}

// Returns the deny reason when an implementer runs a whole package suite through run.mjs, or null. A full core run takes about 6 minutes and the gate already runs it once per session.
export function scopeReason(words, agentType) {
  if (agentType !== 'implementer') return null;
  const at = words.findIndex((word) => word.endsWith('run.mjs'));
  if (at < 0 || words[at + 1] !== 'test') return null;
  const dash = words.indexOf('--', at);
  if (dash >= 0 && dash < words.length - 1) return null;
  return `Run only the tests under your own paths: ${RUNNER} test ${words[at + 2] ?? '<pkg>'} ${words.slice(at + 3, dash < 0 ? undefined : dash).join(' ')} -- <paths>`.replace(/  +/g, ' ');
}
