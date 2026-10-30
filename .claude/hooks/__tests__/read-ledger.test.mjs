// Pins the read-ledger hook: denies a read the agent already has in context, lets everything else through, never fails.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../read-ledger.mjs', import.meta.url).pathname;

const tempDir = () => mkdtempSync(join(tmpdir(), 'read-ledger-'));
const lines = (count, tag = 'line') => Array.from({ length: count }, (_, i) => `${tag} ${i + 1} with some padding text`).join('\n') + '\n';

function setup() {
  const dir = tempDir();
  const state = tempDir();
  const file = join(dir, 'big.txt');
  writeFileSync(file, lines(200));
  const call = (event, toolName, toolInput, who = {}, response) => {
    const input = { session_id: 'sess', cwd: dir, hook_event_name: event, tool_name: toolName, tool_input: toolInput, ...who };
    if (event === 'PostToolUse') input.tool_response = response ?? { type: 'text' };
    const result = spawnSync('node', [hook], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, LABSHELF_LEDGER_STATE_DIR: state, LABSHELF_TELEMETRY_SPOOL: join(state, 'spool') } });
    assert.equal(result.status, 0);
    assert.equal(result.stderr, '');
    return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
  };
  // A tool call as Claude Code runs it: checked at PreToolUse, recorded at PostToolUse when it was not denied.
  const run = (toolName, toolInput, who) => {
    const verdict = call('PreToolUse', toolName, toolInput, who);
    if (!verdict) call('PostToolUse', toolName, toolInput, who);
    return verdict;
  };
  const read = (extra = {}, who) => run('Read', { file_path: file, ...extra }, who);
  const bash = (command, who) => run('Bash', { command }, who);
  return { dir, file, read, bash, run, call };
}

const denied = (output) => {
  assert.equal(output?.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, /^already read at \d\d:\d\d:\d\d, unchanged since; use what you have$/);
};

test('the first read is allowed', () => {
  const { read } = setup();
  assert.equal(read(), undefined);
});

test('an identical re-read is denied with a one-line reason', () => {
  const { read } = setup();
  read({ offset: 10, limit: 50 });
  denied(read({ offset: 10, limit: 50 }));
});

test('a file that changed since the read is allowed, and read again from the new content', () => {
  const { file, read } = setup();
  read();
  writeFileSync(file, lines(200, 'edited'));
  assert.equal(read(), undefined);
  denied(read());
});

test('a file whose mtime changed with the same content is allowed', () => {
  const { file, read } = setup();
  read();
  utimesSync(file, new Date(), new Date(Date.now() + 5000));
  assert.equal(read(), undefined);
});

test('the same read by another agent, or by the main thread after a subagent, is allowed', () => {
  const { read } = setup();
  read();
  assert.equal(read({}, { agent_id: 'a1' }), undefined);
  denied(read({}, { agent_id: 'a1' }));
  denied(read());
  assert.equal(read({}, { agent_id: 'a2' }), undefined);
});

test('a range inside earlier reads is denied, also when two reads together cover it', () => {
  const { read } = setup();
  read({ offset: 1, limit: 50 });
  read({ offset: 51, limit: 50 });
  denied(read({ offset: 30, limit: 40 }));
});

test('a range reaching lines never read is allowed', () => {
  const { read } = setup();
  read({ offset: 1, limit: 50 });
  assert.equal(read({ offset: 40, limit: 40 }), undefined);
  assert.equal(read({ offset: 150, limit: 10 }), undefined);
});

test('cat, head, tail, sed and nl after a Read of the whole file are denied', () => {
  const { read, bash } = setup();
  read();
  for (const command of ['cat big.txt', 'nl big.txt', 'head -n 20 big.txt', 'head -5 big.txt', 'tail -n 30 big.txt', "sed -n '10,20p' big.txt", "sed -n '7p' big.txt"]) denied(bash(command));
});

test('a Bash read is recorded for a later Read, and tail covers the end of the file', () => {
  const { read, bash } = setup();
  assert.equal(bash("sed -n '1,100p' big.txt"), undefined);
  denied(read({ offset: 20, limit: 30 }));
  assert.equal(bash('tail -n 10 big.txt'), undefined);
  denied(read({ offset: 195, limit: 6 }));
});

test('Bash commands that are not one plain read are ignored', () => {
  const { read, bash } = setup();
  read();
  for (const command of ['cat big.txt | grep line', 'cat big.txt > out.txt', 'cat big.txt other.txt', 'cat $(echo big.txt)', 'grep line big.txt', 'head -n 5 big.txt; ls', 'cat -n big.txt']) {
    assert.equal(bash(command), undefined, command);
  }
});

test('a file under 2 KB is always allowed', () => {
  const { dir, run } = setup();
  const small = join(dir, 'small.txt');
  writeFileSync(small, 'tiny\n');
  assert.equal(run('Read', { file_path: small }), undefined);
  assert.equal(run('Read', { file_path: small }), undefined);
});

test('a log under .git/labshelf-logs is always allowed', () => {
  const { dir, run } = setup();
  mkdirSync(join(dir, '.git', 'labshelf-logs'), { recursive: true });
  const log = join(dir, '.git', 'labshelf-logs', 'run.log');
  writeFileSync(log, lines(200));
  assert.equal(run('Read', { file_path: log }), undefined);
  assert.equal(run('Read', { file_path: log }), undefined);  const implementer = { agent_id: 'a1', agent_type: 'implementer' };
  for (const command of ['cat .git/labshelf-logs/run.log', 'tail -n 50 .git/labshelf-logs/run.log']) {
    assert.equal(run('Bash', { command }, implementer), undefined, command);
    assert.equal(run('Bash', { command }, implementer), undefined, command);
  }
  assert.equal(run('Read', { file_path: '.git/labshelf-logs/run.log' }, { agent_id: 'a2', agent_type: 'arbiter' }), undefined);
});

test('a missing file, other tools and malformed input exit 0 without output', () => {
  const { dir, run } = setup();
  assert.equal(run('Read', { file_path: join(dir, 'missing.txt') }), undefined);
  assert.equal(run('Edit', { file_path: join(dir, 'big.txt') }), undefined);
  assert.equal(run('Read', {}), undefined);
  for (const input of ['', 'not json', '{"tool_name":']) {
    const result = spawnSync('node', [hook], { input, encoding: 'utf8' });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  }
});

test('a read that another hook denied is not recorded', () => {
  const { file, call } = setup();
  const input = { file_path: file };
  assert.equal(call('PreToolUse', 'Read', input), undefined);
  // No PostToolUse follows: spec-guard or guard-doc-reads denied the call.
  assert.equal(call('PreToolUse', 'Read', input), undefined);
});

test('a failed read is not recorded', () => {
  const { file, call } = setup();
  const input = { file_path: file };
  call('PreToolUse', 'Read', input);
  call('PostToolUse', 'Read', input, {}, { is_error: true, error: 'File does not exist' });
  call('PostToolUse', 'Read', input, {}, 'Error: permission denied');
  assert.equal(call('PreToolUse', 'Read', input), undefined);
  call('PostToolUse', 'Bash', { command: 'cat big.txt' }, {}, { stdout: '', stderr: 'cat: big.txt: x', exitCode: 1 });
  assert.equal(call('PreToolUse', 'Bash', { command: 'cat big.txt' }), undefined);
});

test('a read recorded at PostToolUse makes the identical re-read denied at PreToolUse', () => {
  const { file, call } = setup();
  const input = { file_path: file, offset: 5, limit: 20 };
  assert.equal(call('PreToolUse', 'Read', input), undefined);
  call('PostToolUse', 'Read', input);
  denied(call('PreToolUse', 'Read', input));
});

test('PreToolUse alone records nothing, and an unknown event is ignored', () => {
  const { file, call } = setup();
  call('PreToolUse', 'Read', { file_path: file });
  call('PostToolUse', 'Read', { file_path: file }, { hook_event_name: 'Other' });
  assert.equal(call('PreToolUse', 'Read', { file_path: file }), undefined);
});
