// Guard-bash rules for reading: documents/ read through Bash instead of doc.mjs, and a grep for one identifier that the code-facts index answers; keeps per-session state in a temp file.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseInPlace } from './guard-bash-rewrites.mjs';
import { repoPath, skipOptions } from './guard-bash-shell.mjs';

const DOC_READERS = new Set(['cat', 'tac', 'head', 'tail', 'less', 'more', 'bat', 'batcat', 'nl', 'awk', 'gawk']);
const DOC_PATH = /^documents\/(?!plans\/|ideas\/).*\.md$/;
const DOC_IN_CODE = /documents\/(?!plans\/|ideas\/)[\w./*-]*\.md/;
const ONE_LINERS = /^(python3?(\.\d+)?|node)$/;
const ONE_LINER_FLAGS = new Set(['-c', '-e', '-p', '--eval', '--print']);
const GREP_TOOLS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag']);
const GREP_VALUED = new Set(['-e', '-f', '-A', '-B', '-C', '-m', '-d', '-D', '--include', '--exclude', '--exclude-dir', '--regexp', '--file', '--max-count', '--after-context', '--before-context', '--context']);
const RG_VALUED = new Set(['-e', '-f', '-g', '-t', '-T', '-A', '-B', '-C', '-m', '-j', '-M', '-E', '-r', '--glob', '--iglob', '--type', '--type-not', '--regexp', '--file', '--max-count', '--max-depth', '--after-context', '--before-context', '--context', '--threads', '--replace', '--sort', '--sortr']);
const IDENTIFIER = /^[A-Za-z_$][\w$]{5,}$/;
const ALL_CAPS = /^[A-Z][A-Z0-9_]*$/;
// An internal case change (fooBar, PaperRecord, sha256Hex) or an inner underscore (resolve_root); a single-hump word like Error is plain text.
const CODE_SHAPE = /[a-z0-9][A-Z]|[A-Za-z0-9]_[A-Za-z0-9]/;
const TOKEN = /^[\w$.]+$/;

const safeId = (text) => String(text).replace(/[^\w.-]/g, '_');

// Per-session record of identifiers the guard already redirected and identifiers the session looked up with facts.mjs.
export function openState(input) {
  const dir = process.env.LABSHELF_HOOK_STATE_DIR ?? join(tmpdir(), 'labshelf-hooks');
  const file = join(dir, safeId(input?.session_id ?? 'nosession'), 'bash-guard.json');
  let data = { denied: [], facts: [] };
  try {
    data = { ...data, ...JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    // A missing or unreadable file starts a fresh record.
  }
  return {
    has: (kind, id) => data[kind].includes(id),
    add(kind, id) {
      if (data[kind].includes(id)) return true;
      data[kind].push(id);
      try {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify(data));
        return true;
      } catch {
        return false;
      }
    },
  };
}

// Notes the names a facts.mjs call asked about, so a grep for the same name in this session is not redirected.
export function recordFacts(cmd, state) {
  const at = cmd.words.findIndex((word) => word.endsWith('facts.mjs') || word === 'facts');
  if (at < 0) return;
  if (!cmd.words.slice(0, at + 1).every((word, i) => i === at || ['pnpm', 'node'].includes(word) || word.startsWith('-'))) return;
  for (const word of cmd.words.slice(at + 1)) {
    for (const token of word.split(/\s+/)) {
      if (!TOKEN.test(token)) continue;
      state.add('facts', token);
      for (const part of token.split('.')) if (part) state.add('facts', part);
    }
  }
}

function docReadPath(cmd, ctx) {
  const [name, ...args] = cmd.words;
  const tool = basename(name ?? '');
  const isDoc = (word) => {
    const resolved = repoPath(ctx, word);
    return resolved !== null && DOC_PATH.test(resolved);
  };
  if (DOC_READERS.has(tool)) return args.find(isDoc) ?? null;
  if (tool === 'sed' || tool === 'gsed') return parseInPlace(cmd.words) ? null : (args.find(isDoc) ?? null);
  if (ONE_LINERS.test(tool)) {
    const flag = args.findIndex((arg) => ONE_LINER_FLAGS.has(arg));
    return flag >= 0 && DOC_IN_CODE.test(args[flag + 1] ?? '') ? DOC_IN_CODE.exec(args[flag + 1])[0] : null;
  }
  return null;
}

// A Bash read of a document in documents/ (plans and ideas excepted, as guard-doc-reads.sh does) is redirected to doc.mjs.
export function docReadReason(cmd, ctx) {
  const found = docReadPath(cmd, ctx);
  if (found === null) return null;
  const resolved = repoPath(ctx, found) ?? found;
  const doc = resolved.replace(/^.*?documents\//, '').replace(/\.md$/, '');
  const name = doc.includes('*') ? '<doc>' : doc;
  return `Use: node scripts/docs/doc.mjs ${name} (headings), then node scripts/docs/doc.mjs ${name}#<anchor> (one section). To edit, Read with offset and limit.`;
}

// Splits a grep, rg or git grep command into its single pattern and its paths; null when it has several patterns or reads stdin.
function parseGrep(cmd) {
  const [name, ...args] = cmd.words;
  let tool = basename(name ?? '');
  let rest = args;
  if (tool === 'git') {
    const [verb, ...after] = skipOptions(args, new Set(['-C', '-c']));
    if (verb !== 'grep') return null;
    tool = 'git-grep';
    rest = after;
  }
  if (!GREP_TOOLS.has(tool) && tool !== 'git-grep') return null;
  const valued = tool === 'rg' ? RG_VALUED : GREP_VALUED;
  const patterns = [];
  const positional = [];
  let recursive = tool !== 'grep' && tool !== 'egrep' && tool !== 'fgrep';
  for (let j = 0; j < rest.length; j++) {
    const arg = rest[j];
    if (arg === '--') positional.push(...rest.slice(j + 1));
    if (arg === '--') break;
    if (arg === '--recursive' || arg === '--dereference-recursive') recursive = true;
    else if (arg === '-e' || arg === '--regexp') patterns.push(rest[++j] ?? '');
    else if (arg.startsWith('--regexp=')) patterns.push(arg.slice('--regexp='.length));
    else if (arg.startsWith('--')) j += valued.has(arg) && !arg.includes('=') ? 1 : 0;
    else if (/^-[A-Za-z]+$/.test(arg)) {
      const last = arg.at(-1);
      if (tool !== 'rg' && /[rR]/.test(arg)) recursive = true;
      if (last === 'e') patterns.push(rest[++j] ?? '');
      else if (valued.has(`-${last}`)) j++;
    } else if (!arg.startsWith('-') || arg === '-') positional.push(arg);
  }
  if (!patterns.length) patterns.push(positional.shift() ?? '');
  if (patterns.length !== 1) return null;
  return { pattern: patterns[0], paths: positional, recursive };
}

const identifierOf = (pattern) => {
  const id = pattern.replace(/^\\[b<]/, '').replace(/\\[b>]$/, '');
  return IDENTIFIER.test(id) && !ALL_CAPS.test(id) && CODE_SHAPE.test(id) ? id : null;
};

const isFilePath = (path) => !/[*?]/.test(path) && /\.[A-Za-z0-9]+$/.test(path.split('/').pop());
const inPackages = (resolved) => resolved === 'packages' || resolved.startsWith('packages/');

// A recursive search for one code identifier over packages/ is redirected to facts.mjs once per session and identifier.
export function grepReason(cmd, ctx, state) {
  const parsed = parseGrep(cmd);
  if (!parsed || !parsed.recursive) return null;
  const id = identifierOf(parsed.pattern);
  if (id === null) return null;
  if (parsed.paths.length === 0) {
    if (cmd.piped) return null;
    const here = repoPath(ctx, '.');
    if (here === null || (here !== '' && !inPackages(here))) return null;
  } else {
    const resolved = parsed.paths.map((path) => repoPath(ctx, path));
    if (resolved.some((path, i) => path === null || !inPackages(path) || isFilePath(parsed.paths[i]))) return null;
  }
  if (state.has('facts', id) || state.has('denied', id)) return null;
  if (!state.add('denied', id)) return null;
  return `Use: node scripts/code/facts.mjs def ${id} (where defined) or callers ${id} (call sites); uses <file> lists importers. Repeat the grep if the index lacks it.`;
}
