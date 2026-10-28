#!/usr/bin/env node
// Hook on Read|Bash, PreToolUse and PostToolUse: keeps a ledger of the line ranges each agent has read (Read calls and single-file
// `cat`, `nl`, `head -n`, `tail -n`, `sed -n 'a,bp'`). PreToolUse denies a read whose lines are all covered by earlier reads of the
// unchanged file, since sessions never compact and that content is still in context; PostToolUse records a read only after the tool
// succeeded, so a read that another hook denied or that failed is never counted as seen. Ledger per (session_id, agent_id or "main"), so a subagent
// and the main thread never block each other. Allowed without a trace: files under 2 KB, logs under .git/labshelf-logs/, files
// whose mtime or content changed (the ledger restarts from that read). Edit/Write are not tracked; the changed file lets the next
// read through. Acts unless LABSHELF_READ_LEDGER is "off". Any error: no output, exit 0.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';

const SMALL_FILE_BYTES = 2048;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const DEFAULT_READ_LINES = 2000;
const MAX_RANGES = 60;
const MAX_FILES = 400;
const LOG_DIR = `${sep}.git${sep}labshelf-logs${sep}`;
// Anything the shell would expand, chain or redirect makes the command something other than one plain read.
const UNQUOTED_SHELL = /[;|&<>`$(){}*?!~#\\\n\r]/;
const DOUBLE_QUOTED_SHELL = /[`$\\!\n\r]/;

// Binary files and paged PDFs have no line ranges the ledger could compare.
const BINARY = /\.(?:png|jpe?g|gif|webp|pdf)$/i;

const safeId = (text) => String(text).replace(/[^\w.-]/g, '_');
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const positive = (value) => (/^\d+$/.test(String(value)) && Number(value) > 0 ? Number(value) : undefined);

// Splits a command into words, undefined when it holds anything beyond plain words and quoted strings.
function words(command) {
  const result = [];
  let current = '';
  let started = false;
  let quote = '';
  for (const char of command) {
    if (quote) {
      if (char === quote) quote = '';
      else if (quote === '"' && DOUBLE_QUOTED_SHELL.test(char)) return undefined;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
      started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(current);
      current = '';
      started = false;
    } else if (UNQUOTED_SHELL.test(char)) {
      return undefined;
    } else {
      current += char;
      started = true;
    }
  }
  if (quote) return undefined;
  if (started) result.push(current);
  return result;
}

// Returns { file, from, to } for a Bash command that prints one range of one file ("to" may be Infinity or negative for a tail), else undefined.
function parseBashRead(command) {
  const w = words(command.trim());
  if (!w || w.length < 2) return undefined;
  const [name, ...args] = w;
  const isFile = (token) => token !== undefined && !token.startsWith('-');
  if ((name === 'cat' || name === 'nl') && args.length === 1 && isFile(args[0])) return { file: args[0], from: 1, to: Infinity };
  if (name === 'head' || name === 'tail') {
    const compact = /^-(\d+)$/.exec(args[0] ?? '');
    const count = compact ? positive(compact[1]) : args[0] === '-n' ? positive(args[1]) : undefined;
    const rest = compact ? args.slice(1) : args.slice(2);
    if (!count || rest.length !== 1 || !isFile(rest[0])) return undefined;
    return name === 'head' ? { file: rest[0], from: 1, to: count } : { file: rest[0], tail: count };
  }
  if (name === 'sed' && args[0] === '-n' && args.length === 3 && isFile(args[2])) {
    const match = /^(\d+)(?:,(\d+))?p$/.exec(args[1]);
    if (!match || !positive(match[1])) return undefined;
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    return to >= from ? { file: args[2], from, to } : undefined;
  }
  return undefined;
}

// Returns { file, from, to, tail? } for the tool call, or undefined when it is not a read the ledger understands.
function parseRead(input) {
  const toolInput = input.tool_input ?? {};
  if (input.tool_name === 'Read') {
    if (typeof toolInput.file_path !== 'string' || toolInput.pages !== undefined || BINARY.test(toolInput.file_path)) return undefined;
    const from = positive(toolInput.offset) ?? 1;
    return { file: toolInput.file_path, from, to: from + (positive(toolInput.limit) ?? DEFAULT_READ_LINES) - 1 };
  }
  if (input.tool_name === 'Bash' && typeof toolInput.command === 'string') return parseBashRead(toolInput.command);
  return undefined;
}

const lineCount = (text) => (text === '' ? 0 : text.split('\n').length - (text.endsWith('\n') ? 1 : 0));

// True when the sorted-by-start ranges cover every line of [from, to].
function covers(ranges, from, to) {
  let next = from;
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    if (range.from > next) break;
    next = Math.max(next, range.to + 1);
    if (next > to) return true;
  }
  return false;
}

const clock = (iso) => new Date(iso).toTimeString().slice(0, 8);

// Returns the deny reason when the read is fully covered; otherwise undefined, after adding the read to the ledger when `record` is set.
function decide(ledger, path, read, now, record) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < SMALL_FILE_BYTES || stat.size > MAX_FILE_BYTES || path.includes(LOG_DIR)) return undefined;
  const text = readFileSync(path, 'utf8');
  const lines = lineCount(text);
  let from = read.from;
  let to = Math.min(read.to ?? lines, lines);
  if (read.tail) {
    to = lines;
    from = Math.max(1, lines - read.tail + 1);
  }
  if (from > to) return undefined;
  const hash = createHash('sha1').update(text).digest('hex');
  const entry = ledger.files[path];
  const unchanged = entry && entry.hash === hash && entry.mtimeMs === stat.mtimeMs;
  if (unchanged && covers(entry.ranges, from, to)) {
    const last = entry.ranges.filter((range) => range.from <= to && range.to >= from).sort((a, b) => b.at.localeCompare(a.at))[0];
    return `already read at ${clock(last.at)}, unchanged since; use what you have`;
  }
  if (!record) return undefined;
  const ranges = unchanged ? entry.ranges : [];
  ranges.push({ from, to, at: now });
  delete ledger.files[path];
  ledger.files[path] = { hash, mtimeMs: stat.mtimeMs, ranges: ranges.slice(-MAX_RANGES) };
  for (const old of Object.keys(ledger.files).slice(0, Math.max(0, Object.keys(ledger.files).length - MAX_FILES))) delete ledger.files[old];
  return undefined;
}

// A PostToolUse payload shows a failed tool through an error flag or text; a Bash command that exited non-zero printed nothing to rely on.
function failed(response) {
  if (typeof response === 'string') return /^(?:error|<tool_use_error>)/i.test(response.trim());
  if (!response || typeof response !== 'object') return false;
  const code = response.exitCode ?? response.exit_code;
  return Boolean(response.is_error || response.isError || response.error || response.interrupted || (typeof code === 'number' && code !== 0));
}

async function main() {
  if (process.env.LABSHELF_READ_LEDGER === 'off') return;
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const read = parseRead(input);
  if (!read || !input.session_id) return;
  const path = isAbsolute(read.file) ? read.file : resolve(input.cwd ?? process.cwd(), read.file);
  const stateDir = process.env.LABSHELF_LEDGER_STATE_DIR ?? join(tmpdir(), 'labshelf-read-ledger');
  const stateFile = join(stateDir, `${safeId(input.session_id)}-${safeId(input.agent_id ?? 'main')}.json`);
  const stored = readJson(stateFile);
  const ledger = stored && typeof stored.files === 'object' ? stored : { files: {} };
  if (input.hook_event_name === 'PostToolUse') {
    if (input.tool_response === undefined || failed(input.tool_response)) return;
    if (decide(ledger, path, read, new Date().toISOString(), true)) return;
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(ledger));
    return;
  }
  if (input.hook_event_name !== 'PreToolUse') return;
  const reason = decide(ledger, path, read, '', false);
  if (reason) {
    // Loaded only on a deny, to keep the allow path (nearly every call) at bare node start-up cost.
    const { emit } = await import('../../scripts/agents/telemetry.mjs');
    emit('read_deny', { agent_type: input.agent_type ?? 'main', session_id: input.session_id, tool: input.tool_name, target: path });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
  }
}

try {
  await main();
} catch {
  // A ledger problem must never fail the tool call.
}
