// Pins the read-budget hook: one Explore warning once the main thread has read 60k characters of packages/.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { tempDir } from './transcriptFixtures.mjs';

const hook = new URL('../../../.claude/hooks/read-budget.mjs', import.meta.url).pathname;

function run(input, stateDir) {
  const result = spawnSync('node', [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env: { ...process.env, LABSHELF_BUDGET_STATE_DIR: stateDir } });
  assert.equal(result.status, 0, result.stderr);
  return result;
}

const read = (chars, extra = {}) => ({
  session_id: 'sess',
  hook_event_name: 'PostToolUse',
  tool_name: 'Read',
  tool_input: { file_path: '/repo/packages/core/src/a.ts' },
  tool_response: 'x'.repeat(chars),
  ...extra,
});

const warning = (result) => JSON.parse(result.stdout).hookSpecificOutput;

test('warns once when reads of packages/ pass 60k characters across calls', () => {
  const stateDir = tempDir();
  assert.equal(run(read(25_000), stateDir).stdout, '');
  assert.equal(run(read(25_000), stateDir).stdout, '');
  const output = warning(run(read(15_000), stateDir));
  assert.equal(output.hookEventName, 'PostToolUse');
  assert.match(output.additionalContext, /Explore/);
});

test('later calls in the same session print nothing more', () => {
  const stateDir = tempDir();
  assert.match(warning(run(read(70_000), stateDir)).additionalContext, /Explore/);
  assert.equal(run(read(30_000), stateDir).stdout, '');
  assert.equal(run(read(100_000), stateDir).stdout, '');
});

test('stays silent under the threshold', () => {
  const stateDir = tempDir();
  assert.equal(run(read(30_000), stateDir).stdout, '');
  assert.equal(run(read(29_000), stateDir).stdout, '');
});

test('does nothing inside a subagent', () => {
  const stateDir = tempDir();
  assert.equal(run(read(200_000, { agent_id: 'abc' }), stateDir).stdout, '');
  assert.equal(run(read(200_000, { agent_id: 'abc' }), stateDir).stdout, '');
  // The subagent's reads were not counted toward the main thread.
  assert.equal(run(read(30_000), stateDir).stdout, '');
});

test('ignores calls that do not name packages/', () => {
  const stateDir = tempDir();
  const docs = read(200_000, { tool_input: { file_path: '/repo/documents/plan.md' } });
  assert.equal(run(docs, stateDir).stdout, '');
  assert.equal(run(docs, stateDir).stdout, '');
  assert.equal(run(read(30_000), stateDir).stdout, '');
});

test('counts Grep, Glob and Bash calls that name packages/', () => {
  const stateDir = tempDir();
  const grep = read(20_000, { tool_name: 'Grep', tool_input: { pattern: 'foo', path: '/repo/packages/core' } });
  const glob = read(20_000, { tool_name: 'Glob', tool_input: { pattern: 'packages/**/*.ts' } });
  const bash = read(25_000, { tool_name: 'Bash', tool_input: { command: 'cat packages/core/src/a.ts' } });
  assert.equal(run(grep, stateDir).stdout, '');
  assert.equal(run(glob, stateDir).stdout, '');
  assert.match(warning(run(bash, stateDir)).additionalContext, /Explore/);
});

test('serialises a non-string tool_response before counting it', () => {
  const stateDir = tempDir();
  const object = read(0, { tool_response: { file: { content: 'y'.repeat(70_000) } } });
  assert.match(warning(run(object, stateDir)).additionalContext, /Explore/);
});

test('sessions keep separate totals', () => {
  const stateDir = tempDir();
  assert.equal(run(read(40_000, { session_id: 'one' }), stateDir).stdout, '');
  assert.equal(run(read(40_000, { session_id: 'two' }), stateDir).stdout, '');
  assert.match(warning(run(read(30_000, { session_id: 'one' }), stateDir)).additionalContext, /Explore/);
  assert.match(warning(run(read(30_000, { session_id: 'two' }), stateDir)).additionalContext, /Explore/);
});

test('malformed stdin exits 0 without output', () => {
  const stateDir = tempDir();
  assert.equal(run('not json', stateDir).stdout, '');
  assert.equal(run('', stateDir).stdout, '');
  assert.equal(run({ session_id: 'sess' }, stateDir).stdout, '');
});
