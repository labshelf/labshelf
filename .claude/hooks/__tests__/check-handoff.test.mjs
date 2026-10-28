// Pins the check-handoff hook (PostToolUse on Agent): valid blocks pass silently, bad ones return a notice, the cap and the red-run check hold.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../check-handoff.mjs', import.meta.url).pathname;

const fence = (kind, body) => `\`\`\`yaml ${kind}/v1\n${body}\n\`\`\``;

const REPORT = `schema: report/v1
spec: "3.3"
status: done
changes:
  - {path: a.mjs, what: "one line"}
acceptance:
  - {id: A1, result: pass}
  - {id: A2, result: fail}`;

const SPEC = (command = 'node scripts/agents/run.mjs test tooling --spec 3.3 -- a.test.mjs') => `schema: spec/v1
id: "3.3"
plan: demo
goal: g
level: behaviour
runner: {agent: implementer, model: sonnet}
edit:
  - {path: a.mjs, lines: "1-9", why: "w"}
acceptance:
  - {id: A1, check: "c"}
tests:
  hidden: [t.test.mjs]
  command: ${command}`;

const VERDICT = `schema: verdict/v1
spec: "3.3"
verdict: spec_ambiguous
evidence: []
question: "one or two?"`;

const BRIEF = `schema: brief/v1
area: hooks
question: where
sha: abc1234`;

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'check-handoff-'));
  return { dir, env: { LABSHELF_HOOK_STATE_DIR: join(dir, 'state'), LABSHELF_RUNS_DIR: join(dir, 'runs'), LABSHELF_TELEMETRY_SPOOL: join(dir, 'spool'), LABSHELF_PLAN: '' } };
}

function run(env, { type = 'implementer', prompt = 'do it', response, agentId = 'agent1' }) {
  const input = { session_id: 's1', cwd: process.cwd(), hook_event_name: 'PostToolUse', tool_name: 'Agent', tool_input: { subagent_type: type, prompt }, tool_response: response ?? { status: 'completed', agentId, content: [{ type: 'text', text: 'no block here' }] } };
  const result = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0);
  return result;
}

const reply = (text, agentId = 'agent1') => ({ status: 'completed', agentId, content: [{ type: 'text', text }] });
const notice = (result) => JSON.parse(result.stdout).hookSpecificOutput;

function events(dir) {
  const spool = join(dir, 'spool');
  if (!existsSync(spool)) return [];
  return readdirSync(spool).flatMap((file) => readFileSync(join(spool, file), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));
}

function writeRuns(dir, plan, id, runs) {
  const file = join(dir, 'runs', plan, `${id}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(runs));
}

test('a valid report passes silently, is saved and reported', () => {
  const { dir, env } = setup();
  writeRuns(dir, 'demo', '3.3', [{ failing: [], exit: 0 }]);
  const result = run(env, { prompt: fence('spec', SPEC('node x')), response: reply(`CHANGES\n${fence('report', REPORT)}`) });
  assert.equal(result.stdout, '');
  const saved = readFileSync(join(dir, 'runs', 'demo', '3.3.report.yaml'), 'utf8');
  assert.match(saved, /status: done/);
  assert.equal(saved.includes('```'), false);
  const sent = events(dir).find((event) => event.kind === 'package_report');
  assert.equal(sent.status, 'done');
  assert.equal(sent.acceptance_pass, 1);
  assert.equal(sent.acceptance_fail, 1);
});

test('the report text may come as a string, handbackReport.text or a text array', () => {
  const { env } = setup();
  const block = fence('report', REPORT.replace('status: done', 'status: failed'));
  assert.equal(run(env, { response: block }).stdout, '');
  assert.equal(run(env, { response: { agentId: 'a2', content: [{ type: 'text', text: 'delivered as a message' }], handbackReport: { text: block } } }).stdout, '');
});

test('a missing block returns a notice with the agent id, the errors and the SendMessage instruction', () => {
  const { env } = setup();
  const result = run(env, {});
  const output = notice(result);
  assert.equal(output.hookEventName, 'PostToolUse');
  assert.match(output.additionalContext, /agent1/);
  assert.match(output.additionalContext, /report\/v1/);
  assert.match(output.additionalContext, /SendMessage/);
});

test('an invalid block lists the field errors', () => {
  const { env } = setup();
  const result = run(env, { response: reply(fence('report', REPORT.replace('status: done', 'status: nope'))) });
  assert.match(notice(result).additionalContext, /status: expected one of/);
});

test('the third invalid attempt for one agent passes silently and emits handoff_invalid', () => {
  const { dir, env } = setup();
  assert.match(notice(run(env, {})).additionalContext, /agent1/);
  assert.match(notice(run(env, {})).additionalContext, /agent1/);
  assert.equal(run(env, {}).stdout, '');
  const invalid = events(dir).filter((event) => event.kind === 'handoff_invalid');
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].schema, 'report');
  // Another agent has its own count.
  assert.match(notice(run(env, { agentId: 'agent2' })).additionalContext, /agent2/);
});

test('done with a red or missing test run returns a notice; a green run passes', () => {
  const { dir, env } = setup();
  const prompt = fence('spec', SPEC());
  const response = reply(fence('report', REPORT));
  assert.match(notice(run(env, { prompt, response })).additionalContext, /last test run is not green/);
  writeRuns(dir, 'demo', '3.3', [{ failing: [], exit: 0 }, { failing: ['x'], exit: 1 }]);
  assert.match(notice(run(env, { prompt, response })).additionalContext, /last test run is not green/);
  writeRuns(dir, 'demo', '3.3', [{ failing: ['x'], exit: 1 }, { failing: [], exit: 0 }]);
  assert.equal(run(env, { prompt, response }).stdout, '');
});

test('a missing report emits missing with the need count', () => {
  const { dir, env } = setup();
  const body = `schema: report/v1\nspec: "3.3"\nstatus: missing\nchanges: []\nacceptance: []\nmissing:\n  - {need: a, why: b}\n  - {need: c, why: d}`;
  assert.equal(run(env, { response: reply(fence('report', body)) }).stdout, '');
  assert.equal(events(dir).find((event) => event.kind === 'missing').needs, 2);
});

test('explorer needs a brief, arbiter a verdict (emitted), diagnoser a diagnosis', () => {
  const { dir, env } = setup();
  assert.equal(run(env, { type: 'explorer', response: reply(fence('brief', BRIEF)) }).stdout, '');
  assert.match(notice(run(env, { type: 'explorer', agentId: 'e2' })).additionalContext, /brief\/v1/);
  assert.equal(run(env, { type: 'arbiter', response: reply(fence('verdict', VERDICT)) }).stdout, '');
  assert.equal(events(dir).find((event) => event.kind === 'arbiter_verdict').verdict, 'spec_ambiguous');
  assert.match(notice(run(env, { type: 'diagnoser', agentId: 'd1' })).additionalContext, /diagnosis\/v1/);
  assert.match(notice(run(env, { type: 'tester', agentId: 't1' })).additionalContext, /report\/v1/);
});

test('unknown or missing agent types and bad input pass silently', () => {
  const { env } = setup();
  assert.equal(run(env, { type: 'finisher' }).stdout, '');
  assert.equal(run(env, { type: null }).stdout, '');
  const garbage = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(garbage.status, 0);
  assert.equal(garbage.stdout, '');
});

test('without an agent id in the response, the prompt hash counts the attempts', () => {
  const { env } = setup();
  const response = { status: 'completed', content: 'plain string without a block' };
  assert.match(notice(run(env, { prompt: 'p1', response })).additionalContext, /\S/);
  run(env, { prompt: 'p1', response });
  assert.equal(run(env, { prompt: 'p1', response }).stdout, '');
});

test('the subagent transcript is the fallback when the response has no report text', () => {
  const { dir, env } = setup();
  const main = join(dir, 's1.jsonl');
  const subagents = join(dir, 's1', 'subagents');
  mkdirSync(subagents, { recursive: true });
  writeFileSync(main, '');
  const line = { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'SubagentHandback', input: { message: fence('report', REPORT.replace('status: done', 'status: failed')) } }] } };
  writeFileSync(join(subagents, 'agent-agent1.jsonl'), `${JSON.stringify(line)}\n`);
  const input = { session_id: 's1', transcript_path: main, cwd: process.cwd(), tool_input: { subagent_type: 'implementer', prompt: 'x' }, tool_response: reply('delivered as a message') };
  const result = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.stdout, '');
});

const LAUNCH_TEXT = "Async agent launched successfully. (This tool result is internal metadata.)\nagentId: a86ca7688ce8b2029 (internal ID)\nThe agent is working in the background. You will be notified automatically when it completes.";

test('a background launch result passes silently and is not counted as an invalid handoff', () => {
  const { dir, env } = setup();
  const launched = { isAsync: true, status: 'async_launched', agentId: 'a86ca7688ce8b2029', description: 'd', prompt: 'do it' };
  assert.equal(run(env, { response: launched, agentId: 'a86ca7688ce8b2029' }).stdout, '');
  // Only the launch text, as a string or a text array, is recognised too.
  assert.equal(run(env, { response: LAUNCH_TEXT }).stdout, '');
  assert.equal(run(env, { response: { agentId: 'a2', content: [{ type: 'text', text: LAUNCH_TEXT }] } }).stdout, '');
  assert.equal(events(dir).filter((event) => event.kind === 'handoff_invalid').length, 0);
});

test('a synchronous result without a block still returns a notice next to a launch-like word in the prompt', () => {
  const { env } = setup();
  const result = run(env, { prompt: 'Async agent launched successfully', response: reply('no block') });
  assert.match(notice(result).additionalContext, /report\/v1/);
});
