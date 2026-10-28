#!/usr/bin/env node
// PostToolUse hook on Agent: the fallback for P2 (research/hook-probes.md), where a SubagentStop block did not make the subagent continue.
// Checks the final report of an explorer, implementer, tester, diagnoser or arbiter for a valid handoff block and, if it is bad, tells the main thread to resend the gaps.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseBlocks, validate } from '../../scripts/agents/schemas.mjs';
import { emit } from '../../scripts/agents/telemetry.mjs';

const KIND_BY_AGENT = { explorer: 'brief', implementer: 'report', tester: 'report', diagnoser: 'diagnosis', arbiter: 'verdict' };
const MAX_NOTICES = 2;
const TAIL_BYTES = 512 * 1024;
const ASYNC_LAUNCH_NOTICE = 'Async agent launched successfully';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const safeId = (text) => String(text).replace(/[^\w.-]/g, '_');
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
};

// The text of a tool_response or content value: a string, a {text}, or an array of those.
function textOf(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textOf).join('\n');
  if (isObject(value) && typeof value.text === 'string') return value.text;
  return '';
}

// True for the result of an Agent tool launched in the background: a launch notice, not the final report, which arrives later through another channel.
function isAsyncLaunch(response) {
  if (isObject(response) && (response.isAsync === true || response.status === 'async_launched')) return true;
  return textOf(isObject(response) ? response.content : response).startsWith(ASYNC_LAUNCH_NOTICE);
}

// Candidate report texts of an Agent result, best first: the handback report, then the content, then the bare response.
function responseTexts(response) {
  if (!isObject(response)) return [textOf(response)];
  return [textOf(response.handbackReport), textOf(response.content), textOf(response.result)].filter(Boolean);
}

// The last assistant message of the subagent transcript: its text parts and the message of a handback tool call.
function transcriptText(input, agentId) {
  if (!agentId || !input.transcript_path || !input.session_id) return '';
  try {
    const file = join(dirname(input.transcript_path), input.session_id, 'subagents', `agent-${agentId}.jsonl`);
    const tail = readFileSync(file, 'utf8').slice(-TAIL_BYTES).split('\n').reverse();
    for (const line of tail) {
      if (!line.includes('"assistant"')) continue;
      const content = JSON.parse(line).message?.content;
      if (!Array.isArray(content)) continue;
      const parts = content.map((part) => (part.type === 'text' ? part.text : part.type === 'tool_use' ? textOf(part.input?.message) : ''));
      const text = parts.join('\n').trim();
      if (text) return text;
    }
  } catch {
    // A transcript that cannot be read leaves the response text as the only source.
  }
  return '';
}

// Returns `{raw, value}` of the first text that carries a block of `kind`; `value` is undefined when no text does.
function findBlock(kind, texts) {
  for (const text of texts) {
    const found = parseBlocks(text)[kind];
    if (found !== undefined) return { value: found, raw: rawBlock(kind, text) };
  }
  return { value: undefined, raw: undefined };
}

const rawBlock = (kind, text) => text.match(new RegExp(`^\`\`\`yaml[ \\t]+${kind}/v1[ \\t]*\\r?\\n([\\s\\S]*?)^\`\`\``, 'm'))?.[1];

function runsDir(cwd) {
  if (process.env.LABSHELF_RUNS_DIR) return process.env.LABSHELF_RUNS_DIR;
  const run = spawnSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8' });
  const out = run.status === 0 ? run.stdout.trim() : '';
  return join(out ? resolve(cwd, out) : join(cwd, '.git'), 'labshelf-runs');
}

// Returns the implementer errors that depend on the spec in the prompt: the last test run must be green.
function testRunErrors(spec, cwd) {
  const command = spec?.tests?.command;
  if (typeof command !== 'string' || !spec.id) return [];
  const plan = spec.plan || process.env.LABSHELF_PLAN;
  if (!plan) return [];
  const runs = readJson(join(runsDir(cwd), safeId(plan), `${safeId(spec.id)}.json`));
  const last = Array.isArray(runs) ? runs[runs.length - 1] : undefined;
  return last?.exit === 0 ? [] : [`tests: last test run is not green (run \`${command}\` until it passes, or return status blocked_tests)`];
}

function saveReport(report, raw, spec, cwd) {
  const id = spec?.id ?? report.spec;
  const plan = spec?.plan || process.env.LABSHELF_PLAN || '_';
  const file = join(runsDir(cwd), safeId(plan), `${safeId(id)}.report.yaml`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, raw);
}

function emitValid(kind, value, agentType) {
  const base = { agent_type: agentType, spec: value.spec ?? null };
  if (kind === 'verdict') emit('arbiter_verdict', { ...base, verdict: value.verdict });
  if (kind !== 'report') return;
  const count = (result) => value.acceptance.filter((item) => item.result === result).length;
  emit('package_report', { ...base, status: value.status, acceptance_pass: count('pass'), acceptance_fail: count('fail') });
  if (value.status === 'missing') emit('missing', { ...base, needs: value.missing.length });
}

// Counts the notices sent for one agent in its state file and returns the new count.
function bumpNotices(stateFile) {
  const state = readJson(stateFile) ?? {};
  const count = state.notices ?? 0;
  if (count >= MAX_NOTICES) return undefined;
  mkdirSync(dirname(stateFile), { recursive: true });
  writeFileSync(stateFile, JSON.stringify({ ...state, notices: count + 1 }));
  return count + 1;
}

const instruction = (kind, agentLabel, errors) =>
  `The ${kind}/v1 handoff of ${agentLabel} is not acceptable:\n${errors.map((error) => `- ${error}`).join('\n')}\n` +
  `Resend these errors to the agent with SendMessage (agent id above) and ask for a corrected \`\`\`yaml ${kind}/v1 block; do not accept or act on its report until the block is valid.`;

try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const agentType = input.tool_input?.subagent_type;
  const kind = KIND_BY_AGENT[agentType];
  if (kind && !isAsyncLaunch(input.tool_response)) {
    const prompt = String(input.tool_input?.prompt ?? '');
    const response = input.tool_response;
    const agentId = isObject(response) && response.agentId ? String(response.agentId) : undefined;
    const label = `agent ${agentId ?? `prompt-${createHash('sha1').update(prompt).digest('hex').slice(0, 10)}`} (${agentType})`;
    const cwd = input.cwd ?? process.cwd();

    let found = findBlock(kind, responseTexts(response));
    if (found.value === undefined) found = findBlock(kind, [transcriptText(input, agentId)]);
    const errors = found.value === undefined ? [`no \`\`\`yaml ${kind}/v1 block found in the final message`] : validate(kind, found.value);
    const specValue = parseBlocks(prompt).spec;
    const spec = isObject(specValue) ? specValue : undefined;
    if (!errors.length && kind === 'report' && found.value.status === 'done') errors.push(...testRunErrors(spec, cwd));

    if (!errors.length) {
      if (kind === 'report' && found.raw) saveReport(found.value, found.raw, spec, cwd);
      emitValid(kind, found.value, agentType);
    } else {
      const stateKey = agentId ?? createHash('sha1').update(prompt).digest('hex').slice(0, 16);
      const stateDir = process.env.LABSHELF_HOOK_STATE_DIR ?? join(tmpdir(), 'labshelf-hooks');
      const stateFile = join(stateDir, safeId(input.session_id ?? 'nosession'), `${safeId(`${stateKey}-handoff`)}.json`);
      if (bumpNotices(stateFile) !== undefined) {
        const additionalContext = instruction(kind, label, errors);
        process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } }));
      } else {
        emit('handoff_invalid', { agent_type: agentType, schema: kind, errors: errors.length, blocks: found.value === undefined ? 0 : 1 });
      }
    }
  }
} catch (error) {
  // A handoff check must never fail the tool call.
  process.stderr.write(`check-handoff: ${error.message}\n`);
}
