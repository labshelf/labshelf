// Shell parsing for the guard-bash hook: splits a command line into simple commands, unwraps env, timeout, bash -c, xargs and find -exec, and resolves paths against the tracked directory.
import { basename, isAbsolute, posix } from 'node:path';

const MAX_DEPTH = 4;
const SHELLS = new Set(['bash', 'sh', 'zsh', 'dash']);
const TRANSPARENT = new Set(['time', 'exec', 'nohup', 'command', 'builtin']);
const ENV_VALUED = new Set(['-u', '-C', '-S']);
const TIMEOUT_VALUED = new Set(['-k', '-s', '--kill-after', '--signal']);
const XARGS_VALUED = new Set(['-I', '-n', '-P', '-d', '-L', '-s', '-E', '-a']);
const EXEC_FLAGS = new Set(['-exec', '-execdir', '-ok', '-okdir']);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REDIRECT = /^\d*(>>?|<|&>)/;

// Splits a command into segments at && || ; | and newlines, and each segment into words; quotes group but separators inside them do not split.
// `piped` is true for a segment that reads the output of the one before it.
export function segments(command) {
  const result = [];
  let words = [];
  let word = null;
  let quote = null;
  let pipeNext = false;
  const endWord = () => {
    if (word !== null) words.push(word);
    word = null;
  };
  const endSegment = (piping = false) => {
    endWord();
    if (words.length) result.push({ words, piped: pipeNext });
    words = [];
    pipeNext = piping;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (quote) {
      if (quote === '"' && c === '\\' && '"\\$`'.includes(command[i + 1] ?? '')) word += command[++i];
      else if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= '';
    } else if (c === '\\' && i + 1 < command.length) {
      word = (word ?? '') + command[++i];
    } else if (/\s/.test(c) && c !== '\n') endWord();
    else if (c === '&' && (command[i - 1] === '>' || command[i + 1] === '>' || command[i - 1] === '|')) {
      if (command[i - 1] !== '|') word = (word ?? '') + c;
    } else if (c === '|') endSegment(command[i + 1] !== '|' && command[i - 1] !== '|');
    else if (c === '&' || c === ';' || c === '\n') endSegment();
    else word = (word ?? '') + c;
  }
  endSegment();
  return result;
}

// Returns the words after the leading options; `valued` lists options that take the next word as their value.
export function skipOptions(words, valued = new Set()) {
  let i = 0;
  while (i < words.length && words[i].startsWith('-') && words[i] !== '-') {
    const option = words[i];
    i += valued.has(option) ? 2 : 1;
    if (option === '--') break;
  }
  return words.slice(i);
}

function dropRedirects(words) {
  const kept = [];
  for (let i = 0; i < words.length; i++) {
    const match = REDIRECT.exec(words[i]);
    if (!match) kept.push(words[i]);
    else if (match[0] === words[i]) i++;
  }
  return kept;
}

function afterEnv(words) {
  let i = 0;
  while (i < words.length && (words[i].startsWith('-') || ASSIGNMENT.test(words[i]))) i += ENV_VALUED.has(words[i]) ? 2 : 1;
  return words.slice(i);
}

const afterTimeout = (words) => skipOptions(words, TIMEOUT_VALUED).slice(1);
const afterNice = (words) => (words[0] === '-n' ? words.slice(2) : skipOptions(words));

// Drops redirections and the prefixes that run another command unchanged: VAR=1, env, time, exec, nohup, timeout N, nice.
export function strip(input) {
  let words = dropRedirects(input);
  for (;;) {
    const [head, ...tail] = words;
    let next = null;
    if (head === undefined) return words;
    if (ASSIGNMENT.test(head) || TRANSPARENT.has(head)) next = tail;
    else if (head === 'env') next = afterEnv(tail);
    else if (head === 'timeout') next = afterTimeout(tail);
    else if (head === 'nice') next = afterNice(tail);
    if (next === null) return words;
    words = next;
  }
}

function innerOf(name, args) {
  if (SHELLS.has(basename(name))) {
    const at = args.findIndex((arg) => /^-[a-zA-Z]*c[a-zA-Z]*$/.test(arg));
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : null;
  }
  return name === 'eval' && args.length ? args.join(' ') : null;
}

function execCommands(args) {
  const found = [];
  for (let i = 0; i < args.length; i++) {
    if (!EXEC_FLAGS.has(args[i])) continue;
    let end = i + 1;
    while (end < args.length && args[end] !== ';' && args[end] !== '+') end++;
    found.push(args.slice(i + 1, end));
    i = end;
  }
  return found;
}

function expand(words, piped, fed, depth, found) {
  const [name, ...args] = words;
  if (name === undefined) return;
  const inner = depth < MAX_DEPTH ? innerOf(name, args) : null;
  if (inner !== null) found.push(...commandsOf(inner, depth + 1));
  else if (depth < MAX_DEPTH && name === 'xargs') expand(strip(skipOptions(args, XARGS_VALUED)), piped, true, depth + 1, found);
  else if (depth < MAX_DEPTH && name === 'find' && execCommands(args).length) {
    for (const exec of execCommands(args)) expand(strip(exec), piped, true, depth + 1, found);
  } else found.push({ words, piped, fed });
}

// Removes the body of every heredoc (<<EOF, <<'EOF', <<-EOF), keeping the line that introduces it: the body is data, not commands.
function withoutHeredocBodies(command) {
  const kept = [];
  let pending = [];
  for (const line of command.split('\n')) {
    if (pending.length) {
      const { delimiter, indented } = pending[0];
      if ((indented ? line.trim() : line) === delimiter) pending.shift();
      continue;
    }
    kept.push(line);
    pending = [...line.matchAll(/<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/g)].map((match) => ({ delimiter: match[3], indented: match[1] === '-' }));
  }
  return kept.join('\n');
}

// Every simple command of a command line, in order, as { words, piped, fed }; `fed` marks commands run by xargs or find -exec.
export function commandsOf(command, depth = 0) {
  const found = [];
  for (const segment of segments(withoutHeredocBodies(command))) expand(strip(segment.words), segment.piped, false, depth, found);
  return found;
}

// A repo-relative path ('' is the repo root) of a path as seen from ctx.cwd, or null when it is outside the repo or unknown.
export function repoPath(ctx, path) {
  if (path.startsWith('~') || path.startsWith('$')) return null;
  let relative;
  if (isAbsolute(path)) {
    if (path === ctx.root) relative = '.';
    else if (path.startsWith(`${ctx.root}/`)) relative = path.slice(ctx.root.length + 1);
    else return null;
  } else if (ctx.cwd === null) return null;
  else relative = posix.join(ctx.cwd, path);
  const clean = posix.normalize(relative);
  if (clean === '..' || clean.startsWith('../')) return null;
  return clean === '.' ? '' : clean.replace(/\/$/, '');
}

// Follows a `cd` so later relative paths resolve against the folder it moved to.
export function applyCd(ctx, words) {
  const target = words.slice(1).find((word) => !word.startsWith('-'));
  ctx.cwd = target === undefined ? null : repoPath(ctx, target);
}
