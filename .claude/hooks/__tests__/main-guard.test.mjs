// Pins the main-guard hook: in an unattended plan session the main thread edits only its plan folder.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../main-guard.mjs', import.meta.url).pathname;
const ROOT = '/repo';
const UNATTENDED = { LABSHELF_PLAN: 'demo', LABSHELF_PLAN_SESSION: '3' };

function run(input, env = UNATTENDED) {
  const { LABSHELF_PLAN: _plan, LABSHELF_PLAN_SESSION: _session, ...base } = process.env;
  const spool = mkdtempSync(join(tmpdir(), 'main-guard-'));
  const result = spawnSync('node', [hook], {
    input: JSON.stringify({ session_id: 's', cwd: ROOT, ...input }),
    encoding: 'utf8',
    env: { ...base, CLAUDE_PROJECT_DIR: ROOT, LABSHELF_TELEMETRY_SPOOL: spool, ...env },
  });
  assert.equal(result.status, 0);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
}

const edit = (path, extra = {}) => ({ tool_name: 'Edit', tool_input: { file_path: path }, ...extra });

test('the main thread of an unattended session cannot edit code', () => {
  const inputs = [
    edit('/repo/scripts/x.mjs'),
    edit('packages/core/src/a.ts'),
    { tool_name: 'NotebookEdit', tool_input: { notebook_path: '/repo/n.ipynb' } },
    edit('/tmp/elsewhere.txt'),
  ];
  for (const input of inputs) {
    const output = run(input);
    assert.equal(output?.permissionDecision, 'deny', JSON.stringify(input));
    assert.match(output.permissionDecisionReason, /documents\/plans\/demo\/.*spec package in the session file.*implementer/);
  }
});

test('documents stay editable: the plan folder, contracts and docs', () => {
  assert.equal(run(edit('/repo/documents/contracts/qmd-items.md')), undefined);
  assert.equal(run(edit('/repo/documents/plans/demo/sessions/3.yaml')), undefined);
  assert.equal(run({ tool_name: 'Write', tool_input: { file_path: 'documents/plans/demo/tests/3.1/a.test.mjs' } }), undefined);
});

test('subagents, attended sessions and other tools pass untouched', () => {
  assert.equal(run(edit('/repo/scripts/x.mjs', { agent_id: 'a1', agent_type: 'implementer' })), undefined);
  assert.equal(run(edit('/repo/scripts/x.mjs'), {}), undefined);
  assert.equal(run(edit('/repo/scripts/x.mjs'), { LABSHELF_PLAN: 'demo' }), undefined);
  assert.equal(run({ tool_name: 'Bash', tool_input: { command: 'echo x > scripts/x.mjs' } }), undefined);
  assert.equal(run({ tool_name: 'Read', tool_input: { file_path: '/repo/scripts/x.mjs' } }), undefined);
});

test('bad stdin exits 0 without output', () => {
  const result = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8', env: { ...process.env, ...UNATTENDED } });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
});
