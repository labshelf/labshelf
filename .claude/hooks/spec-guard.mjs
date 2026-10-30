#!/usr/bin/env node
// PreToolUse hook: keeps an implementer, tester or arbiter that runs with a spec/v1 block inside that spec. The plan's tests are
// read-only: an implementer or arbiter may read its spec's tests (the documents/plans/<slug>/tests/<id>/ originals and their in-place
// copies), but only the tester writes them; any other subagent, with or without a spec, is denied Edit/Write and Bash writes (sed -i,
// redirection, mv, rm, cp, git checkout, ...) on documents/plans/*/tests/. Logs under .git/labshelf-logs/ are free to read for every
// role (Read, Grep, and a plain cat/head/tail/grep/wc). Other subagents without a spec, and the main thread (main-guard's job), pass
// otherwise untouched; any internal error exits 0 with no output.
// A headless `claude --agent <role> -p` that run.mjs spawns (the arbiter after a stall, the tester after test_wrong) is a main
// thread: its hook input has agent_type but no agent_id. run.mjs marks it with LABSHELF_ROLE=<role> on the child only; with that
// variable and no agent_id the guard treats the main thread as that role and reads its spec from the session transcript.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseBlocks, validate } from '../../scripts/agents/schemas.mjs';
import { emit } from '../../scripts/agents/telemetry.mjs';

const ROLES = new Set(['implementer', 'tester', 'arbiter']);
const REASON = 'Outside your spec: return report/v1 with status missing and say what you needed.';
const TEST_REASON =
  'Tests are read-only: only the tester changes them, after an arbiter verdict. If a test looks wrong, return report/v1 with status blocked_tests and say why in spec terms.';
const INDEX_QUOTA = 10;
const FILE_TOOLS = { Read: 'file_path', Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMPOUND = /[;&|`<>\n]|\$\(/;
const PLAN_TESTS = /^documents\/plans\/[^/]+\/tests(\/|$)/;
const PLAN_TESTS_IN_COMMAND = /documents\/plans\/\S*\/tests\//;
const PLAN_GLOB_IN_COMMAND = /documents\/plans\/\S*[*?[{]/;
const LOGS = '.git/labshelf-logs';
// A command that may change a file it names: in-place edits, redirection (not `2>&1`), tee, file moves and deletions, git restores.
const WRITE_IN_COMMAND =
  /(^|[\s;&|(])(sed|perl)\s[^;&|]*-\w*i|(?<![0-9&])>{1,2}(?!&)|(^|[\s;&|(])(tee|mv|rm|cp|truncate|dd|ln|unlink|install|touch|chmod|rsync)(\s|$)|\bgit\s+(checkout|restore|rm|mv|apply|stash|reset)\b/;
const LOG_READ = /^(cat|head|tail|grep|wc|nl)$/;

const safeId = (text) => String(text).replace(/[^\w.-]/g, '_');
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const entryPath = (entry) => (typeof entry === 'string' ? entry : entry?.path);
const pathsOf = (list) => (Array.isArray(list) ? list.map(entryPath).filter((path) => typeof path === 'string') : []);
const covers = (entry, rel) => {
  const base = entry.replace(/^\.\//, '').replace(/\/+$/, '');
  return rel === base || rel.startsWith(`${base}/`);
};
const coveredBy = (entries, rel) => entries.some((entry) => covers(entry, rel));

// Repo-relative form of a path, or undefined when it leaves the repository.
function normalise(root, cwd, path) {
  const rel = relative(root, resolve(cwd, path));
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : rel.split('\\').join('/');
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.type === 'text' ? part.text : '')).join('\n');
  return '';
}

// The text of the first user message of the subagent transcript, or undefined when the transcript cannot be read.
function firstPrompt(input) {
  const file =
    input.agent_transcript_path ??
    (input.labshelfMain ? input.transcript_path : undefined) ?? (input.transcript_path && input.session_id ? join(dirname(input.transcript_path), input.session_id, 'subagents', `agent-${input.agent_id}.jsonl`) : undefined);
  if (!file) return undefined;
  let lines;
  try {
    lines = readFileSync(file, 'utf8').split('\n');
  } catch {
    return undefined;
  }
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      const message = entry.message ?? entry;
      if (entry.type === 'user' || message.role === 'user') return textOf(message.content);
    } catch {
      // A line that is not JSON cannot be the prompt.
    }
  }
  return '';
}

function specFrom(prompt) {
  const block = parseBlocks(prompt).spec;
  if (!isObject(block) || validate('spec', block).length) return null;
  return block;
}

function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state));
}

const hasRunId = (command, id) => new RegExp(`(^|\\s)--spec(\\s+|=)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(command);
const RUN = /^node\s+(\.\/)?scripts\/agents\/run\.mjs(\s|$)/;
const DOC = /^node\s+(\.\/)?scripts\/docs\/doc\.mjs(\s|$)/;
const INDEX = /^(?:node\s+(?:\.\/)?scripts\/code\/facts\.mjs|pnpm\s+-s\s+facts)\s+(def|fn|sig|similar|find|callers|uses|tests)(\s|$)/;
const GIT = /^git\s+(diff|status)(\s|$)/;

// Arguments of a git command that are paths: not flags, not the `--` separator.
const gitPaths = (command) => command.split(/\s+/).slice(2).filter((arg) => !arg.startsWith('-'));

class Deny extends Error {
  constructor(reason = REASON) {
    super(reason);
    this.reason = reason;
  }
}

// The in-place copies `plan start` makes of the spec's tests: each hidden path without its documents/plans/<slug>/tests/<id>/ prefix.
function inPlaceCopies(spec) {
  const prefix = `documents/plans/${spec.plan}/tests/${spec.id}/`;
  return pathsOf(spec.tests?.hidden)
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length));
}

const testFilesOf = (spec) => [...pathsOf(spec.tests?.hidden), ...inPlaceCopies(spec)];

// Whether a non-tester writing `rel` would change a test file: any plan's tests, or (with a spec) its own tests and their copies.
const isTestFile = (spec, rel) => rel !== undefined && (PLAN_TESTS.test(rel) || (spec !== null && coveredBy(testFilesOf(spec), rel)));

// Whether a Bash command writes to a test file: it names one (or globs under documents/plans/) and has a write marker.
function writesTests(spec, command) {
  if (!WRITE_IN_COMMAND.test(command)) return false;
  if (PLAN_TESTS_IN_COMMAND.test(command) || PLAN_GLOB_IN_COMMAND.test(command)) return true;
  return spec !== null && testFilesOf(spec).some((path) => command.includes(path));
}

// A plain read of log files only: `cat|head|tail|grep|wc|nl` whose file arguments all sit under .git/labshelf-logs/.
function isLogRead(command, state) {
  if (COMPOUND.test(command)) return false;
  const [verb, ...args] = command.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  if (!LOG_READ.test(verb ?? '')) return false;
  let operands = args.filter((arg, index) => !arg.startsWith('-') && !(/^\d+$/.test(arg) && args[index - 1] === '-n'));
  if (verb === 'grep' && !args.includes('-e')) operands = operands.slice(1);
  return operands.length > 0 && operands.every((arg) => {
    const rel = normalise(state.root, state.cwd, arg.replace(/^["']|["']$/g, ''));
    return rel !== undefined && covers(LOGS, rel);
  });
}

// Returns true when allowed, false when outside the spec, or 'test' for a write to a test file by a non-tester.
function checkFile(role, spec, toolName, rel) {
  const edit = pathsOf(spec.edit);
  const create = pathsOf(spec.create);
  const read = pathsOf(spec.read);
  const tests = testFilesOf(spec);
  const ownTests = `documents/plans/${spec.plan}/tests/${spec.id}`;
  const isWrite = WRITE_TOOLS.has(toolName);
  if (rel !== undefined && !isWrite && covers(LOGS, rel)) return true;
  if (role === 'tester') {
    if (rel !== undefined && (covers(ownTests, rel) || coveredBy(inPlaceCopies(spec), rel))) return true;
    if (isWrite) return false;
    return rel !== undefined && !PLAN_TESTS.test(rel) && coveredBy([...edit, ...read, ...create], rel);
  }
  if (rel === undefined) return false;
  if (isWrite && isTestFile(spec, rel)) return 'test';
  if (role === 'arbiter') return !isWrite && coveredBy([...edit, ...read, ...create, ...tests], rel);
  if (isWrite) return coveredBy([...edit, ...create], rel);
  if (coveredBy(tests, rel)) return true;
  if (PLAN_TESTS.test(rel)) return false;
  return coveredBy([...edit, ...read, ...create], rel);
}

// Returns undefined for an allowed command, or throws Deny.
function checkBash(role, spec, command, state) {
  const trimmed = command.trim();
  if (role !== 'tester' && writesTests(spec, trimmed)) throw new Deny(TEST_REASON);
  if (isLogRead(trimmed, state)) return undefined;
  const exact = [spec.tests?.command, ...(Array.isArray(spec.commands) ? spec.commands : [])].filter((entry) => typeof entry === 'string').map((entry) => entry.trim());
  if (role !== 'arbiter' && exact.includes(trimmed)) return undefined;
  if (!trimmed || COMPOUND.test(trimmed)) throw new Deny();
  if (RUN.test(trimmed)) {
    if (role === 'implementer' && !hasRunId(trimmed, String(spec.id))) throw new Deny();
    return undefined;
  }
  if (role === 'arbiter') {
    if (GIT.test(trimmed) && trimmed.startsWith('git diff')) return undefined;
    throw new Deny();
  }
  if (DOC.test(trimmed)) return undefined;
  if (role !== 'implementer') throw new Deny();
  if (GIT.test(trimmed)) {
    if (trimmed.includes('--output')) throw new Deny();
    const own = [...pathsOf(spec.edit), ...pathsOf(spec.create)];
    const ok = gitPaths(trimmed).every((arg) => {
      const rel = normalise(state.root, state.cwd, arg);
      return rel !== undefined && coveredBy(own, rel);
    });
    if (ok) return undefined;
    throw new Deny();
  }
  const index = INDEX.exec(trimmed);
  if (index) {
    if ((state.file.index ?? 0) >= INDEX_QUOTA) throw new Deny();
    state.file.index = (state.file.index ?? 0) + 1;
    state.indexQuery = index[1];
    return undefined;
  }
  throw new Deny();
}

function targetOf(toolName, toolInput) {
  if (toolName === 'Bash') return String(toolInput.command ?? '');
  if (toolName === 'Grep' || toolName === 'Glob') return String(toolInput.pattern ?? toolInput.path ?? '');
  return String(toolInput[FILE_TOOLS[toolName]] ?? '');
}

function deny(reason, event) {
  emit('spec_deny', event);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

// The test write check for a subagent without a spec: Edit/Write or a Bash write under documents/plans/*/tests/.
function guardTestsWithoutSpec(input, role, root, cwd) {
  const toolName = input.tool_name;
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const writes =
    toolName === 'Bash'
      ? writesTests(null, String(toolInput.command ?? '').trim())
      : WRITE_TOOLS.has(toolName) && typeof toolInput[FILE_TOOLS[toolName]] === 'string' && isTestFile(null, normalise(root, cwd, toolInput[FILE_TOOLS[toolName]]));
  if (writes) deny(TEST_REASON, { agent_type: role, session_id: input.session_id, tool: toolName, target: targetOf(toolName, toolInput) });
}

// The role and agent id of the hook's caller: a subagent's own, or LABSHELF_ROLE for a main thread run.mjs spawned headless.
function identify(input) {
  const envRole = process.env.LABSHELF_ROLE;
  if (input.agent_id || !envRole) return input;
  return { ...input, agent_type: envRole, agent_id: `main-${envRole}`, labshelfMain: true };
}

function main(raw) {
  const input = identify(raw);
  const role = input.agent_type;
  if (!input.agent_id) return;
  const cwd = input.cwd ?? process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  if (!ROLES.has(role)) return guardTestsWithoutSpec(input, role, root, cwd);
  const stateDir = process.env.LABSHELF_HOOK_STATE_DIR ?? join(tmpdir(), 'labshelf-hooks');
  const stateFile = join(stateDir, safeId(input.session_id ?? 'nosession'), `${safeId(input.agent_id)}.json`);
  let file = readJson(stateFile);
  if (!isObject(file) || !('spec' in file)) {
    const prompt = firstPrompt(input);
    if (prompt === undefined) return guardTestsWithoutSpec(input, role, root, cwd);
    file = { spec: specFrom(prompt), index: 0 };
    saveState(stateFile, file);
  }
  const spec = file.spec;
  if (!isObject(spec)) return role === 'tester' ? undefined : guardTestsWithoutSpec(input, role, root, cwd);

  const toolName = input.tool_name;
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const state = { root, cwd, file };
  let verdict;
  if (toolName === 'Bash') {
    try {
      checkBash(role, spec, String(toolInput.command ?? ''), state);
      verdict = true;
    } catch (error) {
      if (!(error instanceof Deny)) throw error;
      verdict = error.reason === TEST_REASON ? 'test' : false;
    }
  } else if (toolName === 'Grep' || toolName === 'Glob') {
    const rel = typeof toolInput.path === 'string' ? normalise(root, cwd, toolInput.path) : undefined;
    verdict = rel !== undefined && covers(LOGS, rel);
  } else if (toolName in FILE_TOOLS) {
    const target = toolInput[FILE_TOOLS[toolName]];
    verdict = typeof target === 'string' && checkFile(role, spec, toolName, normalise(root, cwd, target));
  } else {
    return;
  }

  if (verdict !== true) {
    deny(verdict === 'test' ? TEST_REASON : REASON, { agent_type: role, spec: spec.id, session_id: input.session_id, tool: toolName, target: targetOf(toolName, toolInput) });
    return;
  }
  // The facts CLI emits index_query itself; the guard only counts the quota.
  if (state.indexQuery) saveState(stateFile, file);
}

try {
  main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
