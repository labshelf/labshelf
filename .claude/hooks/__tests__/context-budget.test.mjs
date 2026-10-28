// Pins the context-budget hook: warns once per crossing, stays silent otherwise, never fails.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../context-budget.mjs', import.meta.url).pathname;

const tempDir = () => mkdtempSync(join(tmpdir(), 'context-budget-'));

const assistant = (id, context) => ({
  type: 'assistant',
  message: { id, usage: { input_tokens: 2, cache_creation_input_tokens: context - 2, cache_read_input_tokens: 0, output_tokens: 5 }, content: [] },
});

function writeJsonl(path, lines) {
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
}

// Writes <dir>/<sessionId>.jsonl plus one subagent transcript and returns their paths.
function writeSession(dir, sessionId, { mainContext, agentContext, agentId = 'abc' }) {
  const main = join(dir, `${sessionId}.jsonl`);
  const subagents = join(dir, sessionId, 'subagents');
  mkdirSync(subagents, { recursive: true });
  const agent = join(subagents, `agent-${agentId}.jsonl`);
  writeJsonl(main, [assistant('m1', mainContext)]);
  writeJsonl(agent, [assistant('a1', agentContext)]);
  return { main, agent };
}

// The hook runs as in an attended session unless `env` names a plan session; a plan run around the tests does not leak in.
function run(input, stateDir, env = {}) {
  const { LABSHELF_PLAN: _plan, LABSHELF_PLAN_SESSION: _session, LABSHELF_MAIN_CONTEXT_STOP: _stop, LABSHELF_BUDGET_STOP_FILE: _file, ...base } = process.env;
  const result = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...base, LABSHELF_BUDGET_STATE_DIR: stateDir, LABSHELF_TELEMETRY_SPOOL: join(stateDir, 'spool'), ...env } });
  assert.equal(result.status, 0);
  return result;
}

const warning = (result) => JSON.parse(result.stdout).hookSpecificOutput.additionalContext;

test('a subagent over 60k is warned once, again only after another 40k', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 10_000, agentContext: 65_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc', hook_event_name: 'PostToolUse' };

  assert.match(warning(run(input, stateDir)), /≈65k tokens, over the 60k budget.*return your report now/);
  assert.equal(run(input, stateDir).stdout, '');

  writeJsonl(agent, [assistant('a2', 90_000)]);
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a3', 106_000)]);
  assert.match(warning(run(input, stateDir)), /≈106k/);
});

test('an explorer has a 100k budget', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 10_000, agentContext: 99_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc', agent_type: 'explorer' };
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a2', 101_000)]);
  assert.match(warning(run(input, stateDir)), /≈101k tokens, over the 100k budget/);
});

test('an implementer has the default 60k budget and each first warning emits budget_warning', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 10_000, agentContext: 59_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc', agent_type: 'implementer' };
  assert.equal(run(input, stateDir).stdout, '');
  assert.equal(existsSync(join(stateDir, 'spool')), false);
  writeJsonl(agent, [assistant('a2', 61_000)]);
  assert.match(warning(run(input, stateDir)), /≈61k tokens, over the 60k budget/);
  run(input, stateDir);
  const [file] = readdirSync(join(stateDir, 'spool'));
  const events = readFileSync(join(stateDir, 'spool', file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'budget_warning');
  assert.equal(events[0].agent_type, 'implementer');
  assert.equal(events[0].context_tokens, 61_000);
  assert.equal(events[0].budget, 60_000);
});

test('the main thread has a 150k budget and a delegate-what-is-left message', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main } = writeSession(dir, 'sess', { mainContext: 149_000, agentContext: 5 });
  const input = { session_id: 'sess', transcript_path: main };
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(main, [assistant('m2', 151_000)]);
  assert.match(warning(run(input, stateDir)), /over the 150k budget.*delegate/);
});

test('falling back under budget re-arms the warning', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 1, agentContext: 70_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc' };
  run(input, stateDir);
  writeJsonl(agent, [assistant('a2', 10_000)]);
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a3', 70_000)]);
  assert.match(warning(run(input, stateDir)), /≈70k/);
});

test('a missing transcript or bad stdin exits 0 without output on stdout', () => {
  const stateDir = tempDir();
  const missing = run({ session_id: 's', transcript_path: join(tempDir(), 'none.jsonl') }, stateDir);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /context-budget:/);
  const bad = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout, '');
});

const UNATTENDED = { LABSHELF_PLAN: 'demo', LABSHELF_PLAN_SESSION: '3' };

test('an unattended main thread past 100k is told to park its packages and end the turn, and the stop is recorded', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const marker = join(stateDir, 'runs', 'stop.json');
  const env = { ...UNATTENDED, LABSHELF_BUDGET_STOP_FILE: marker };
  const { main } = writeSession(dir, 'sess', { mainContext: 99_000, agentContext: 5 });
  const input = { session_id: 'sess', transcript_path: main };
  assert.equal(run(input, stateDir, env).stdout, '');
  assert.equal(existsSync(marker), false);

  writeJsonl(main, [assistant('m2', 101_000)]);
  const first = JSON.parse(run(input, stateDir, env).stdout);
  assert.equal(first.decision, 'block');
  assert.match(first.reason, /≈101k tokens, over the 100k limit.*pending in the session file.*end the turn/);
  assert.equal(first.hookSpecificOutput.additionalContext, first.reason);
  assert.equal(JSON.parse(readFileSync(marker, 'utf8')).context_tokens, 101_000);

  writeJsonl(main, [assistant('m3', 110_000)]);
  assert.equal(JSON.parse(run(input, stateDir, env).stdout).decision, 'block');
  writeJsonl(main, [assistant('m4', 121_000)]);
  const hard = JSON.parse(run(input, stateDir, env).stdout);
  assert.equal(hard.continue, false);
  assert.match(hard.stopReason, /end the turn/);
});

test('LABSHELF_MAIN_CONTEXT_STOP moves the limit, and subagents of an unattended session keep their warning', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main } = writeSession(dir, 'sess', { mainContext: 60_000, agentContext: 65_000 });
  const stop = JSON.parse(run({ session_id: 'sess', transcript_path: main }, stateDir, { ...UNATTENDED, LABSHELF_MAIN_CONTEXT_STOP: '50000' }).stdout);
  assert.match(stop.reason, /over the 50k limit/);
  const agent = run({ session_id: 'sess', transcript_path: main, agent_id: 'abc' }, stateDir, UNATTENDED);
  assert.match(warning(agent), /over the 60k budget.*return your report now/);
});
