// Pins the spec-guard hook: an implementer, tester or arbiter with a spec/v1 block stays inside it; everyone else passes untouched.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../spec-guard.mjs', import.meta.url).pathname;
const REASON = 'Outside your spec: return report/v1 with status missing and say what you needed.';
const HIDDEN = 'documents/plans/demo/tests/9.1/scripts/__tests__/thing.test.mjs';
const TEST_COMMAND = 'node scripts/agents/run.mjs test tooling --spec 9.1 -- scripts/__tests__/thing.test.mjs';

const specBlock = (overrides = {}) => {
  const spec = {
    schema: 'spec/v1',
    id: '9.1',
    plan: 'demo',
    goal: 'thing',
    level: 'behaviour',
    runner: { agent: 'implementer', model: 'sonnet' },
    sha: 'abc1234',
    depends_on: [],
    edit: [{ path: 'scripts/thing.mjs', lines: '1-20', why: 'the thing' }],
    create: ['scripts/newdir/'],
    read: [{ path: 'scripts/other.mjs', lines: '1-9', why: 'context' }],
    callers: [],
    seams: [],
    decided: ['x'],
    acceptance: [{ id: 'A1', check: 'works' }],
    tests: { hidden: [HIDDEN], command: TEST_COMMAND },
    commands: ['node scripts/agents/run.mjs typecheck core'],
    do_not_touch: [],
    ...overrides,
  };
  return `\`\`\`yaml spec/v1\n${JSON.stringify(spec, null, 2)}\n\`\`\``;
};

// A session with a main transcript and one subagent transcript whose first user message is `prompt`.
function setup(prompt, agentId = 'ag1') {
  const dir = mkdtempSync(join(tmpdir(), 'spec-guard-'));
  const sessionId = 'sess';
  const subagents = join(dir, sessionId, 'subagents');
  mkdirSync(subagents, { recursive: true });
  const main = join(dir, `${sessionId}.jsonl`);
  writeFileSync(main, '{"type":"user","message":{"role":"user","content":"main"}}\n');
  const agent = join(subagents, `agent-${agentId}.jsonl`);
  const lines = [{ type: 'user', message: { role: 'user', content: [{ type: 'text', text: prompt }] } }, { type: 'assistant', message: { content: [] } }];
  writeFileSync(agent, lines.map((line) => JSON.stringify(line)).join('\n') + '\n');
  return { dir, sessionId, main, agentId, state: mkdtempSync(join(tmpdir(), 'spec-guard-state-')), spool: mkdtempSync(join(tmpdir(), 'spec-guard-spool-')) };
}

function call(env, agentType, toolName, toolInput, extra = {}) {
  const input = { hook_event_name: 'PreToolUse', session_id: env.sessionId, transcript_path: env.main, cwd: env.dir, agent_id: env.agentId, agent_type: agentType, tool_name: toolName, tool_input: toolInput, ...extra };
  const result = spawnSync('node', [hook], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: env.dir, LABSHELF_HOOK_STATE_DIR: env.state, LABSHELF_TELEMETRY_SPOOL: env.spool },
  });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

function assertDenied(output) {
  assert.ok(output, 'expected a deny');
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.equal(output.permissionDecisionReason, REASON);
}

const events = (env) => readdirSync(env.spool).flatMap((file) => readFileSync(join(env.spool, file), 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)));

test('implementer reads spec paths and is denied outside them, with spec_deny telemetry', () => {
  const env = setup(specBlock());
  for (const path of ['scripts/thing.mjs', 'scripts/other.mjs', 'scripts/newdir/a.mjs']) {
    assert.equal(call(env, 'implementer', 'Read', { file_path: join(env.dir, path) }), null, path);
  }
  assert.equal(call(env, 'implementer', 'Read', { file_path: 'scripts/thing.mjs' }), null);
  assertDenied(call(env, 'implementer', 'Read', { file_path: join(env.dir, 'scripts/unrelated.mjs') }));
  assertDenied(call(env, 'implementer', 'Read', { file_path: join(env.dir, 'scripts/../scripts/unrelated.mjs') }));
  assertDenied(call(env, 'implementer', 'Read', { file_path: '/etc/passwd' }));
  const denies = events(env).filter((event) => event.kind === 'spec_deny');
  assert.equal(denies.length, 3);
  assert.equal(denies[0].tool, 'Read');
  assert.ok(denies[0].target.endsWith('scripts/unrelated.mjs'));
});

test('implementer may write only edit and create paths', () => {
  const env = setup(specBlock());
  assert.equal(call(env, 'implementer', 'Edit', { file_path: join(env.dir, 'scripts/thing.mjs') }), null);
  assert.equal(call(env, 'implementer', 'Write', { file_path: join(env.dir, 'scripts/newdir/deep/a.mjs') }), null);
  assertDenied(call(env, 'implementer', 'Write', { file_path: join(env.dir, 'scripts/outside.mjs') }));
  assertDenied(call(env, 'implementer', 'Write', { file_path: join(env.dir, 'scripts/other.mjs') }));
  assertDenied(call(env, 'implementer', 'MultiEdit', { file_path: join(env.dir, 'scripts/other.mjs') }));
  assertDenied(call(env, 'implementer', 'NotebookEdit', { notebook_path: join(env.dir, 'scripts/n.ipynb') }));
});

test('hidden tests are denied to the implementer for Read and for Bash naming them', () => {
  const env = setup(specBlock());
  assertDenied(call(env, 'implementer', 'Read', { file_path: join(env.dir, HIDDEN) }));
  assertDenied(call(env, 'implementer', 'Read', { file_path: join(env.dir, 'documents/plans/demo/tests/other/x.test.mjs') }));
  assertDenied(call(env, 'implementer', 'Bash', { command: `cat ${HIDDEN}` }));
  assertDenied(call(env, 'implementer', 'Bash', { command: 'node scripts/docs/doc.mjs documents/plans/demo/tests/9.1/x' }));
  assertDenied(call(env, 'implementer', 'Bash', { command: 'cat scripts/thing.mjs' }));
});

test('Grep and Glob are denied to the implementer', () => {
  const env = setup(specBlock());
  assertDenied(call(env, 'implementer', 'Grep', { pattern: 'foo', path: 'scripts' }));
  assertDenied(call(env, 'implementer', 'Glob', { pattern: 'scripts/**' }));
});

test('implementer Bash allowlist', () => {
  const env = setup(specBlock());
  const allowed = [
    TEST_COMMAND,
    `  ${TEST_COMMAND}  `,
    'node scripts/agents/run.mjs typecheck core',
    'node scripts/agents/run.mjs typecheck core --spec 9.1',
    'node scripts/docs/doc.mjs code#placement',
    'git status',
    'git diff',
    'git diff --stat scripts/thing.mjs',
    'git diff -- scripts/newdir/a.mjs',
    'node scripts/code/facts.mjs def emit',
    'node scripts/code/facts.mjs similar "parse a spec block"',
    'pnpm -s facts callers emit',
  ];
  for (const command of allowed) assert.equal(call(env, 'implementer', 'Bash', { command }), null, command);
  const denied = [
    'node scripts/agents/run.mjs typecheck browser',
    'node scripts/agents/run.mjs test tooling --spec 9.2 -- x',
    'git diff scripts/other.mjs',
    'git status; rm -rf x',
    'node scripts/docs/doc.mjs code#placement && cat x',
    'node scripts/docs/doc.mjs code | sh',
    'node scripts/docs/doc.mjs `whoami`',
    'node scripts/docs/doc.mjs $(whoami)',
    'node scripts/code/facts.mjs build',
    'node scripts/code/facts.mjs sql "select 1"',
    'node scripts/code/facts.mjs def x && ls',
    'pnpm facts def x',
    'ls',
    'rm scripts/thing.mjs',
    'pnpm test',
    '',
  ];
  for (const command of denied) assertDenied(call(env, 'implementer', 'Bash', { command }));
});

test('the 11th index call is denied', () => {
  const env = setup(specBlock());
  for (let i = 0; i < 10; i += 1) assert.equal(call(env, 'implementer', 'Bash', { command: `node scripts/code/facts.mjs callers symbol${i}` }), null, `call ${i + 1}`);
  assertDenied(call(env, 'implementer', 'Bash', { command: 'pnpm -s facts find "x"' }));
  const all = events(env);
  assert.equal(all.filter((event) => event.kind === 'index_query').length, 0);
  assert.equal(all.filter((event) => event.kind === 'spec_deny').length, 1);
  // Another agent has its own quota.
  const other = { ...env, agentId: 'ag2' };
  writeFileSync(join(env.dir, 'sess', 'subagents', 'agent-ag2.jsonl'), readFileSync(join(env.dir, 'sess', 'subagents', 'agent-ag1.jsonl')));
  assert.equal(call(other, 'implementer', 'Bash', { command: 'node scripts/code/facts.mjs def x' }), null);
});

test('the spec is read from agent_transcript_path when the input has it', () => {
  const env = setup(specBlock());
  const path = join(env.dir, 'sess', 'subagents', 'agent-ag1.jsonl');
  const moved = { ...env, main: join(env.dir, 'missing', 'main.jsonl') };
  assertDenied(call(moved, 'implementer', 'Read', { file_path: join(env.dir, 'scripts/unrelated.mjs') }, { agent_transcript_path: path }));
});

test('tester writes only in its tests dir and runs only run.mjs and doc.mjs', () => {
  const env = setup(specBlock({ runner: { agent: 'tester', model: 'sonnet' } }));
  const own = 'documents/plans/demo/tests/9.1';
  assert.equal(call(env, 'tester', 'Write', { file_path: join(env.dir, own, 'scripts/__tests__/thing.test.mjs') }), null);
  assert.equal(call(env, 'tester', 'Edit', { file_path: join(env.dir, own, 'a.mjs') }), null);
  assert.equal(call(env, 'tester', 'Read', { file_path: join(env.dir, own, 'a.mjs') }), null);
  assert.equal(call(env, 'tester', 'Read', { file_path: join(env.dir, 'scripts/thing.mjs') }), null);
  assertDenied(call(env, 'tester', 'Write', { file_path: join(env.dir, 'scripts/thing.mjs') }));
  assertDenied(call(env, 'tester', 'Write', { file_path: join(env.dir, 'documents/plans/demo/tests/9.2/a.mjs') }));
  assertDenied(call(env, 'tester', 'Read', { file_path: join(env.dir, 'documents/plans/demo/tests/9.2/a.mjs') }));
  assertDenied(call(env, 'tester', 'Read', { file_path: join(env.dir, 'scripts/unrelated.mjs') }));
  assertDenied(call(env, 'tester', 'Grep', { pattern: 'x' }));
  assert.equal(call(env, 'tester', 'Bash', { command: 'node scripts/agents/run.mjs test tooling -- documents/plans/demo/tests/9.1/a.test.mjs' }), null);
  assert.equal(call(env, 'tester', 'Bash', { command: 'node scripts/docs/doc.mjs code#placement' }), null);
  assertDenied(call(env, 'tester', 'Bash', { command: 'git diff' }));
  assertDenied(call(env, 'tester', 'Bash', { command: 'node scripts/code/facts.mjs def x' }));
  assertDenied(call(env, 'tester', 'Bash', { command: 'ls' }));
});

test('arbiter cannot Edit or Write, reads spec paths, hidden tests and logs, runs run.mjs and git diff', () => {
  const env = setup(specBlock({ runner: { agent: 'arbiter', model: 'sonnet' } }));
  assertDenied(call(env, 'arbiter', 'Edit', { file_path: join(env.dir, 'scripts/thing.mjs') }));
  assertDenied(call(env, 'arbiter', 'Write', { file_path: join(env.dir, 'scripts/newdir/a.mjs') }));
  assert.equal(call(env, 'arbiter', 'Read', { file_path: join(env.dir, 'scripts/thing.mjs') }), null);
  assert.equal(call(env, 'arbiter', 'Read', { file_path: join(env.dir, HIDDEN) }), null);
  assert.equal(call(env, 'arbiter', 'Read', { file_path: join(env.dir, '.git/labshelf-logs/1-test.log') }), null);
  assertDenied(call(env, 'arbiter', 'Read', { file_path: join(env.dir, 'scripts/unrelated.mjs') }));
  assertDenied(call(env, 'arbiter', 'Grep', { pattern: 'x' }));
  assert.equal(call(env, 'arbiter', 'Bash', { command: 'node scripts/agents/run.mjs test tooling -- x' }), null);
  assert.equal(call(env, 'arbiter', 'Bash', { command: 'git diff main -- scripts' }), null);
  assertDenied(call(env, 'arbiter', 'Bash', { command: 'git status' }));
  assertDenied(call(env, 'arbiter', 'Bash', { command: 'cat scripts/thing.mjs' }));
});

test('an implementer without a spec block, other agents and the main thread pass untouched', () => {
  const unrelated = { file_path: join('/', 'etc', 'passwd') };
  const noSpec = setup('Please fix the bug in scripts/thing.mjs.');
  assert.equal(call(noSpec, 'implementer', 'Read', unrelated), null);
  assert.equal(call(noSpec, 'implementer', 'Bash', { command: 'ls' }), null);
  const invalid = setup('```yaml spec/v1\nschema: spec/v1\nid: "1"\n```');
  assert.equal(call(invalid, 'implementer', 'Read', unrelated), null);

  const withSpec = setup(specBlock());
  assert.equal(call(withSpec, 'explorer', 'Read', unrelated), null);
  assert.equal(call(withSpec, 'diagnoser', 'Grep', { pattern: 'x' }), null);
  assert.equal(call(withSpec, undefined, 'Read', unrelated, { agent_id: undefined }), null);
  assert.equal(events(withSpec).length, 0);
});

test('bad input or a missing transcript exits 0 with no output', () => {
  const result = spawnSync('node', [hook], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  const env = setup(specBlock());
  const missing = { ...env, agentId: 'nobody' };
  assert.equal(call(missing, 'implementer', 'Read', { file_path: '/etc/passwd' }), null);
});
