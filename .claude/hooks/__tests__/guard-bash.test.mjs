// Pins the guard-bash hook: raw test, typecheck and build commands are denied with the run.mjs equivalent, everything else passes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const hook = new URL('../guard-bash.mjs', import.meta.url).pathname;

function run(command, input = { tool_name: 'Bash', tool_input: { command } }) {
  const result = spawnSync('node', [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8' });
  assert.equal(result.status, 0);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

function assertDenied(command, equivalent) {
  const output = run(command);
  assert.ok(output, `expected deny for: ${command}`);
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, /^Use: node scripts\/agents\/run\.mjs /);
  if (equivalent) assert.ok(output.permissionDecisionReason.includes(equivalent), `${output.permissionDecisionReason} lacks ${equivalent}`);
}

test('denies a raw core test and names the wrapper command', () => {
  assertDenied('pnpm --filter @labshelf/core test -- x', 'node scripts/agents/run.mjs test core -- x');
});

test('denies typecheck and build with the package folder', () => {
  assertDenied('pnpm --filter @labshelf/browser typecheck', 'node scripts/agents/run.mjs typecheck browser');
  assertDenied('pnpm --filter=@labshelf/vscode build', 'node scripts/agents/run.mjs build vscode');
});

test('denies pnpm test, pnpm test:tooling, jest, tsc and node --test', () => {
  assertDenied('pnpm test');
  assertDenied('pnpm test:tooling', 'node scripts/agents/run.mjs test tooling');
  assertDenied('npx jest packages/core');
  assertDenied('pnpm exec tsc --noEmit');
  assertDenied('FOO=1 jest');
  assertDenied('node --test scripts/**/*.test.mjs', 'node scripts/agents/run.mjs test tooling');
});

test('denies a raw command inside a chain', () => {
  assertDenied('cd packages/core && pnpm --filter @labshelf/core test -- y | tail -5', 'node scripts/agents/run.mjs test core -- y');
  assertDenied('echo start; tsc -p .');
});

test('allows pnpm gate, run.mjs calls and unrelated commands', () => {
  assert.equal(run('pnpm gate --no-lint'), null);
  assert.equal(run('node scripts/agents/run.mjs test core -- x'), null);
  assert.equal(run('node scripts/agents/run.mjs cmd -- pnpm --filter @labshelf/browser build:chrome'), null);
  assert.equal(run('git status && ls'), null);
  assert.equal(run('pnpm --filter @labshelf/browser build:chrome'), null);
});

test('ignores raw commands that are only text', () => {
  assert.equal(run('rg -n "pnpm test" .claude'), null);
  assert.equal(run('git commit -m "run jest && tsc"'), null);
});

test('never fails on bad input', () => {
  assert.equal(run('', 'not json'), null);
  assert.equal(run('', {}), null);
});
