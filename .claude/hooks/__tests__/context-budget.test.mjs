// Pins the context-budget hook: warns once per crossing, stays silent otherwise, never fails; in an unattended plan
// session it warns the main thread past 100k and never denies a call or ends the session; every subagent is warned past 80k.
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
  const { LABSHELF_PLAN: _plan, LABSHELF_PLAN_SESSION: _session, LABSHELF_MAIN_CONTEXT_STOP: _stop, LABSHELF_MAIN_CONTEXT_WARN: _warn, LABSHELF_MAIN_CONTEXT_HARD: _hard, LABSHELF_MAIN_CONTEXT_KILL: _kill, LABSHELF_BUDGET_WARN_FILE: _file, ...base } = process.env;
  const result = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...base, LABSHELF_BUDGET_STATE_DIR: stateDir, LABSHELF_TELEMETRY_SPOOL: join(stateDir, 'spool'), ...env } });
  assert.equal(result.status, 0);
  return result;
}

const warning = (result) => JSON.parse(result.stdout).hookSpecificOutput.additionalContext;

test('a subagent at 70k gets nothing, at 85k a finish-and-report warning, and again only after another 20k', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 10_000, agentContext: 70_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc', hook_event_name: 'PostToolUse' };

  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a2', 85_000)]);
  const first = warning(run(input, stateDir));
  assert.match(first, /≈85k tokens, over the 80k warning.*Do not start new broad reads.*Finish the work in flight.*deterministic scripts.*then return your report with what is left undone/);
  assert.doesNotMatch(first, /now|stop/i);
  assert.equal(run(input, stateDir).stdout, '');

  writeJsonl(agent, [assistant('a3', 100_000)]);
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a4', 106_000)]);
  assert.match(warning(run(input, stateDir)), /≈106k/);
});

test('every subagent type shares the 80k threshold and each first warning emits budget_warning', () => {
  for (const agentType of ['explorer', 'implementer', 'tester', undefined]) {
    const dir = tempDir();
    const stateDir = tempDir();
    const { main, agent } = writeSession(dir, 'sess', { mainContext: 10_000, agentContext: 79_000 });
    const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc', agent_type: agentType };
    assert.equal(run(input, stateDir).stdout, '');
    assert.equal(existsSync(join(stateDir, 'spool')), false);
    writeJsonl(agent, [assistant('a2', 81_000)]);
    assert.match(warning(run(input, stateDir)), /≈81k tokens, over the 80k warning/);
    run(input, stateDir);
    const [file] = readdirSync(join(stateDir, 'spool'));
    const events = readFileSync(join(stateDir, 'spool', file), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, 'budget_warning');
    assert.equal(events[0].agent_type, agentType ?? null);
    assert.equal(events[0].context_tokens, 81_000);
    assert.equal(events[0].budget, 80_000);
  }
});

test('the main thread has a 100k budget and a delegate-what-is-left message', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main } = writeSession(dir, 'sess', { mainContext: 99_000, agentContext: 5 });
  const input = { session_id: 'sess', transcript_path: main };
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(main, [assistant('m2', 101_000)]);
  assert.match(warning(run(input, stateDir)), /over the 100k budget.*delegate/);
});

test('falling back under budget re-arms the warning', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const { main, agent } = writeSession(dir, 'sess', { mainContext: 1, agentContext: 90_000 });
  const input = { session_id: 'sess', transcript_path: main, agent_id: 'abc' };
  run(input, stateDir);
  writeJsonl(agent, [assistant('a2', 10_000)]);
  assert.equal(run(input, stateDir).stdout, '');
  writeJsonl(agent, [assistant('a3', 90_000)]);
  assert.match(warning(run(input, stateDir)), /≈90k/);
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

// Inputs of the PreToolUse calls the unattended check sees.
const pre = (main, tool_name, tool_input) => ({ session_id: 'sess', transcript_path: main, hook_event_name: 'PreToolUse', tool_name, tool_input });
const implementer = (main) => pre(main, 'Agent', { subagent_type: 'implementer', prompt: 'p' });
const gitStatus = (main) => pre(main, 'Bash', { command: 'git status' });
const output = (result) => (result.stdout ? JSON.parse(result.stdout) : undefined);
const denied = (result) => output(result)?.hookSpecificOutput?.permissionDecision === 'deny';

test('an unattended main thread under 100k passes every call and records no marker', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const marker = join(stateDir, 'stop.json');
  const { main } = writeSession(dir, 'sess', { mainContext: 99_000, agentContext: 5 });
  assert.equal(run(implementer(main), stateDir, { ...UNATTENDED, LABSHELF_BUDGET_WARN_FILE: marker }).stdout, '');
  assert.equal(existsSync(marker), false);
});

test('past 100k an unattended main thread is warned on crossing and every 20k, denies nothing, and the marker is written', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const marker = join(stateDir, 'runs', 'stop.json');
  const env = { ...UNATTENDED, LABSHELF_BUDGET_WARN_FILE: marker };
  const { main } = writeSession(dir, 'sess', { mainContext: 101_000, agentContext: 5 });

  const first = output(run(implementer(main), stateDir, env)).hookSpecificOutput;
  assert.equal(first.permissionDecision, undefined);
  assert.match(first.additionalContext, /≈101k tokens, over the 100k warning.*Weigh what is left.*hand off.*pending in the session file.*finish here/);
  assert.equal(JSON.parse(readFileSync(marker, 'utf8')).context_tokens, 101_000);

  writeJsonl(main, [assistant('m2', 115_000)]);
  assert.equal(run(implementer(main), stateDir, env).stdout, '');
  writeJsonl(main, [assistant('m3', 122_000)]);
  assert.match(output(run(gitStatus(main), stateDir, env)).hookSpecificOutput.additionalContext, /≈122k/);
  // The PostToolUse run of the same hook stays silent for the unattended main thread.
  assert.equal(run({ session_id: 'sess', transcript_path: main, hook_event_name: 'PostToolUse' }, stateDir, env).stdout, '');
});

test('past 150k and 190k an unattended main thread only gets a warning: no deny, no continue:false', () => {
  const dir = tempDir();
  const stateDir = tempDir();
  const marker = join(stateDir, 'warn.json');
  const env = { ...UNATTENDED, LABSHELF_BUDGET_WARN_FILE: marker };
  const { main } = writeSession(dir, 'sess', { mainContext: 151_000, agentContext: 5 });
  const calls = (main) => [
    implementer(main),
    pre(main, 'Agent', { subagent_type: 'tester', prompt: 'p' }),
    pre(main, 'Agent', { subagent_type: 'diagnoser', prompt: 'p' }),
    pre(main, 'Bash', { command: 'node scripts/plans/plan.mjs start documents/plans/demo 3' }),
    pre(main, 'Bash', { command: 'node scripts/plans/plan.mjs prompt documents/plans/demo 3 S2' }),
    pre(main, 'Agent', { subagent_type: 'finisher', prompt: 'p' }),
    gitStatus(main),
  ];
  for (const context of [151_000, 191_000, 400_000]) {
    writeJsonl(main, [assistant(`m${context}`, context)]);
    for (const call of calls(main)) {
      const result = run(call, tempDir(), env);
      const out = output(result);
      assert.match(out.hookSpecificOutput.additionalContext, new RegExp(`≈${Math.round(context / 1000)}k tokens, over the 100k warning`));
      assert.equal(out.hookSpecificOutput.permissionDecision, undefined);
      assert.equal(out.continue, undefined);
      assert.equal(out.stopReason, undefined);
      assert.ok(!denied(result));
    }
  }
  assert.ok(existsSync(marker));
});

test('the warn envs move the threshold (the older _STOP name still works), the removed HARD and KILL envs do nothing, and subagents keep their warning', () => {
  const dir = tempDir();
  const { main } = writeSession(dir, 'sess', { mainContext: 60_000, agentContext: 85_000 });
  const warnOf = (env) => output(run(gitStatus(main), tempDir(), { ...UNATTENDED, ...env }))?.hookSpecificOutput?.additionalContext;
  assert.match(warnOf({ LABSHELF_MAIN_CONTEXT_WARN: '50000' }), /over the 50k warning/);
  assert.match(warnOf({ LABSHELF_MAIN_CONTEXT_STOP: '40000' }), /over the 40k warning/);
  const hardKill = output(run(implementer(main), tempDir(), { ...UNATTENDED, LABSHELF_MAIN_CONTEXT_WARN: '50000', LABSHELF_MAIN_CONTEXT_HARD: '55000', LABSHELF_MAIN_CONTEXT_KILL: '58000' }));
  assert.equal(hardKill.hookSpecificOutput.permissionDecision, undefined);
  assert.equal(hardKill.continue, undefined);
  const agent = run({ session_id: 'sess', transcript_path: main, agent_id: 'abc', hook_event_name: 'PostToolUse' }, tempDir(), UNATTENDED);
  assert.match(warning(agent), /over the 80k warning.*then return your report/);
});
