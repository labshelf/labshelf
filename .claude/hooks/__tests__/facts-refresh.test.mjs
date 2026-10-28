// Pins the facts-refresh hook (PostToolUse Edit|Write|MultiEdit): an edit under packages/*/src or packages/*/__tests__ marks the index dirty and
// starts a background build unless one runs; no database, another path or bad input leaves everything alone and exits 0 with no output.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const hook = new URL('../facts-refresh.mjs', import.meta.url).pathname;
const factsCli = new URL('../../../scripts/code/facts.mjs', import.meta.url).pathname;
const B = 'packages/core/src/b.ts';

let root;
let env;

const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const facts = (...args) => spawnSync(process.execPath, [factsCli, ...args], { env, encoding: 'utf8' });
const dirty = () => existsSync(join(root, '.code-facts', 'dirty'));
const lockPath = () => join(root, '.code-facts', 'build.lock');
const hold = () => writeFileSync(lockPath(), String(process.pid));
const unhold = () => rmSync(lockPath(), { force: true });
const names = (file) => {
  const db = new DatabaseSync(join(root, '.code-facts', 'facts.db'), { readOnly: true });
  try {
    return db.prepare('SELECT name FROM units WHERE file = ? ORDER BY name').all(file).map((row) => row.name);
  } finally {
    db.close();
  }
};
const edit = (path, tool = 'Edit', extra = {}) => {
  const started = Date.now();
  const run = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's', cwd: root, tool_name: tool, tool_input: { file_path: join(root, path) }, ...extra }),
    encoding: 'utf8',
    env,
  });
  return { status: run.status, out: run.stdout, err: run.stderr, ms: Date.now() - started };
};
const waitFor = async (check, ms = 30000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'labshelf-refresh-'));
  env = { ...process.env, CLAUDE_PROJECT_DIR: root, LABSHELF_FACTS_ROOT: root, LABSHELF_TELEMETRY_SPOOL: join(root, '.spool') };
  delete env.LABSHELF_FACTS_DB;
  delete env.LABSHELF_TELEMETRY;
  put('packages/core/package.json', JSON.stringify({ name: '@labshelf/core', version: '0.0.0', main: 'src/index.ts', types: 'src/index.ts' }));
  put('packages/core/src/index.ts', 'export { first } from "./b.js";\n');
  put(B, 'export function first(): number {\n  return 1;\n}\n');
  mkdirSync(join(root, 'node_modules', '@labshelf'), { recursive: true });
  symlinkSync(join('..', '..', 'packages', 'core'), join(root, 'node_modules', '@labshelf', 'core'));
  spawnSync('git', ['init', '-q'], { cwd: root });
});

after(() => {
  unhold();
  rmSync(root, { recursive: true, force: true });
});

test('without a database the hook is silent and leaves no marker', () => {
  const result = edit(B);
  assert.deepEqual([result.status, result.out, result.err], [0, '', '']);
  assert.equal(existsSync(join(root, '.code-facts', 'dirty')), false);
  const built = facts('build', '--quiet');
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(names(B), ['first']);
});

test('an edit under a source folder leaves dirty and starts no second build while one runs', async () => {
  hold();
  put(B, 'export function first(): number {\n  return 1;\n}\n\nexport function second(): number {\n  return 2;\n}\n');
  const result = edit(B, 'Edit');
  assert.deepEqual([result.status, result.out], [0, '']);
  assert.ok(result.ms < 1000, `took ${result.ms} ms`);
  assert.equal(dirty(), true);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(dirty(), true, 'a second build would have cleared the marker');
  assert.deepEqual(names(B), ['first']);
  unhold();
  // The next build updates the rows of b.ts and clears the marker.
  const built = facts('build', '--quiet');
  assert.equal(built.status, 0, built.stderr);
  assert.deepEqual(names(B), ['first', 'second']);
  assert.equal(dirty(), false);
});

test('with no build running the hook starts one in the background that refreshes the rows', async () => {
  unhold();
  put(B, 'export function first(): number {\n  return 1;\n}\n\nexport function second(): number {\n  return 2;\n}\n\nexport function third(): number {\n  return 3;\n}\n');
  const result = edit(B, 'Write');
  assert.deepEqual([result.status, result.out], [0, '']);
  assert.ok(await waitFor(() => names(B).includes('third') && !dirty()), 'the background build did not finish');
});

test('MultiEdit, tsx files and __tests__ folders count; other paths do not', () => {
  hold();
  const counts = [
    ['MultiEdit', B],
    ['Edit', 'packages/vscode/src/ui/panel.tsx'],
    ['Write', 'packages/core/__tests__/b.test.ts'],
  ];
  for (const [tool, path] of counts) {
    rmSync(join(root, '.code-facts', 'dirty'), { force: true });
    edit(path, tool);
    assert.equal(dirty(), true, path);
  }
  const ignored = ['README.md', 'packages/core/src/data.json', 'packages/core/src/b.js', 'packages/core/docs/b.ts', 'scripts/code/x.ts', 'packages/core/lib/b.ts', '../outside/packages/core/src/b.ts'];
  for (const path of ignored) {
    rmSync(join(root, '.code-facts', 'dirty'), { force: true });
    const result = edit(path);
    assert.deepEqual([result.status, result.out], [0, ''], path);
    assert.equal(dirty(), false, path);
  }
  unhold();
});

test('bad input, a missing path and unrelated tools exit 0 with no output', () => {
  hold();
  rmSync(join(root, '.code-facts', 'dirty'), { force: true });
  for (const input of ['', 'not json', '{}', JSON.stringify({ tool_name: 'Edit', tool_input: {} }), JSON.stringify({ tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, B) } })]) {
    const run = spawnSync(process.execPath, [hook], { input, encoding: 'utf8', env });
    assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', ''], input);
  }
  assert.equal(dirty(), false);
  unhold();
});

test('build clears the marker at the start', () => {
  writeFileSync(join(root, '.code-facts', 'dirty'), '');
  const built = facts('build', '--quiet');
  assert.equal(built.status, 0, built.stderr);
  assert.equal(dirty(), false);
});

test('a build that finds another build running keeps the marker for that build', () => {
  hold();
  writeFileSync(join(root, '.code-facts', 'dirty'), '');
  assert.equal(facts('build', '--quiet').status, 0);
  assert.equal(dirty(), true);
  unhold();
});
