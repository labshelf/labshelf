#!/usr/bin/env node
// PreToolUse hook: keeps an implementer, tester or arbiter that runs with a spec/v1 block inside that spec, and away from hidden tests.
// Any agent without such a spec (and the main thread) passes untouched; any internal error exits 0 with no output.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseBlocks, validate } from '../../scripts/agents/schemas.mjs';
import { emit } from '../../scripts/agents/telemetry.mjs';

const ROLES = new Set(['implementer', 'tester', 'arbiter']);
const REASON = 'Outside your spec: return report/v1 with status missing and say what you needed.';
const CTX_QUOTA = 10;
const FILE_TOOLS = { Read: 'file_path', Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' };
const WRITE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const COMPOUND = /[;&|`<>\n]|\$\(/;
const PLAN_TESTS = /^documents\/plans\/[^/]+\/tests(\/|$)/;
const PLAN_TESTS_IN_COMMAND = /documents\/plans\/\S*\/tests\//;
const PLAN_GLOB_IN_COMMAND = /documents\/plans\/\S*[*?[{]/;

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
    input.agent_transcript_path ?? (input.transcript_path && input.session_id ? join(dirname(input.transcript_path), input.session_id, 'subagents', `agent-${input.agent_id}.jsonl`) : undefined);
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
const CTX = /^node\s+(\.\/)?scripts\/ctx\/ctx\.mjs\s+(def|refs|q)(\s|$)/;
const GIT = /^git\s+(diff|status)(\s|$)/;

// Arguments of a git command that are paths: not flags, not the `--` separator.
const gitPaths = (command) => command.split(/\s+/).slice(2).filter((arg) => !arg.startsWith('-'));

class Deny extends Error {}

function checkFile(role, spec, toolName, rel) {
  const edit = pathsOf(spec.edit);
  const create = pathsOf(spec.create);
  const read = pathsOf(spec.read);
  const hidden = pathsOf(spec.tests?.hidden);
  const ownTests = `documents/plans/${spec.plan}/tests/${spec.id}`;
  const isWrite = WRITE_TOOLS.has(toolName);
  if (role === 'tester') {
    if (rel !== undefined && covers(ownTests, rel)) return true;
    if (isWrite) return false;
    return rel !== undefined && !coveredBy(hidden, rel) && !PLAN_TESTS.test(rel) && coveredBy([...edit, ...read, ...create], rel);
  }
  if (rel === undefined) return false;
  if (role === 'arbiter') return !isWrite && (coveredBy([...edit, ...read, ...create, ...hidden], rel) || covers('.git/labshelf-logs', rel));
  if (coveredBy(hidden, rel) || PLAN_TESTS.test(rel)) return false;
  return isWrite ? coveredBy([...edit, ...create], rel) : coveredBy([...edit, ...read, ...create], rel);
}

// Returns undefined for an allowed command, or throws Deny.
function checkBash(role, spec, command, state) {
  const trimmed = command.trim();
  const exact = [spec.tests?.command, ...(Array.isArray(spec.commands) ? spec.commands : [])].filter((entry) => typeof entry === 'string').map((entry) => entry.trim());
  if (role !== 'arbiter' && exact.includes(trimmed)) return undefined;
  if (!trimmed || COMPOUND.test(trimmed)) throw new Deny();
  if (role === 'implementer') {
    const hidden = pathsOf(spec.tests?.hidden);
    if (PLAN_TESTS_IN_COMMAND.test(trimmed) || PLAN_GLOB_IN_COMMAND.test(trimmed) || hidden.some((path) => trimmed.includes(path))) throw new Deny();
  }
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
  const ctx = CTX.exec(trimmed);
  if (ctx) {
    if ((state.file.ctx ?? 0) >= CTX_QUOTA) throw new Deny();
    state.file.ctx = (state.file.ctx ?? 0) + 1;
    state.ctxQuery = ctx[2];
    return undefined;
  }
  throw new Deny();
}

function targetOf(toolName, toolInput) {
  if (toolName === 'Bash') return String(toolInput.command ?? '');
  if (toolName === 'Grep' || toolName === 'Glob') return String(toolInput.pattern ?? toolInput.path ?? '');
  return String(toolInput[FILE_TOOLS[toolName]] ?? '');
}

function main(input) {
  const role = input.agent_type;
  if (!input.agent_id || !ROLES.has(role)) return;
  const stateDir = process.env.LABSHELF_HOOK_STATE_DIR ?? join(tmpdir(), 'labshelf-hooks');
  const stateFile = join(stateDir, safeId(input.session_id ?? 'nosession'), `${safeId(input.agent_id)}.json`);
  let file = readJson(stateFile);
  if (!isObject(file) || !('spec' in file)) {
    const prompt = firstPrompt(input);
    if (prompt === undefined) return;
    file = { spec: specFrom(prompt), ctx: 0 };
    saveState(stateFile, file);
  }
  const spec = file.spec;
  if (!isObject(spec)) return;

  const toolName = input.tool_name;
  const toolInput = isObject(input.tool_input) ? input.tool_input : {};
  const cwd = input.cwd ?? process.cwd();
  const root = process.env.CLAUDE_PROJECT_DIR ?? cwd;
  const state = { root, cwd, file };
  let allowed;
  if (toolName === 'Bash') {
    try {
      checkBash(role, spec, String(toolInput.command ?? ''), state);
      allowed = true;
    } catch (error) {
      if (!(error instanceof Deny)) throw error;
      allowed = false;
    }
  } else if (toolName === 'Grep' || toolName === 'Glob') {
    allowed = false;
  } else if (toolName in FILE_TOOLS) {
    const target = toolInput[FILE_TOOLS[toolName]];
    allowed = typeof target === 'string' && checkFile(role, spec, toolName, normalise(root, cwd, target));
  } else {
    return;
  }

  const common = { agent_type: role, spec: spec.id, session_id: input.session_id };
  if (!allowed) {
    emit('spec_deny', { ...common, tool: toolName, target: targetOf(toolName, toolInput) });
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: REASON } }));
    return;
  }
  if (state.ctxQuery) {
    saveState(stateFile, file);
    emit('index_query', { ...common, query_kind: state.ctxQuery });
  }
}

try {
  main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
