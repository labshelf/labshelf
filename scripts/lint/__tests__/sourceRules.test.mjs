// Pins the source rules of scripts/lint/sourceRules.mjs: the ratchets, the four changed rules and the deleted-test condition.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  checkFile,
  commentedCodeProblems,
  contractProblems,
  cssLiteralProblems,
  deletedTestProblems,
  headerProblems,
  historyProblems,
  planSizeProblems,
  sizeProblems,
  suppressionProblems,
  testMirrorProblems,
} from '../sourceRules.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'sourceRules.mjs');
const SRC = 'packages/core/src/sample.ts';
const nLines = (n) => `${'x\n'.repeat(n)}`;
const existsIn = (...paths) => (path) => paths.includes(path);

test('source files may hold 400 lines, tests 500', () => {
  assert.deepEqual(sizeProblems(SRC, nLines(400), null), []);
  assert.equal(sizeProblems(SRC, nLines(401), null).length, 1);
  assert.deepEqual(sizeProblems('packages/core/__tests__/a.test.ts', nLines(500), null), []);
  assert.equal(sizeProblems('packages/core/__tests__/a.test.ts', nLines(501), null).length, 1);
  assert.equal(sizeProblems('packages/core/build/a.mjs', nLines(401), null).length, 1);
  assert.deepEqual(sizeProblems('README.md', nLines(900), null), []);
});

test('an oversize file may stay the same size or shrink', () => {
  assert.deepEqual(sizeProblems(SRC, nLines(450), nLines(450)), []);
  assert.deepEqual(sizeProblems(SRC, nLines(450), nLines(500)), []);
  assert.equal(sizeProblems(SRC, nLines(451), nLines(450)).length, 1);
});

test('plan and session size count characters', () => {
  assert.equal(planSizeProblems('documents/plans/x/plan.md', 'a'.repeat(12001)).length, 1);
  assert.deepEqual(planSizeProblems('documents/plans/x/plan.md', 'a'.repeat(12000)), []);
  assert.equal(planSizeProblems('documents/plans/x/sessions/01.md', 'a'.repeat(6001)).length, 1);
  assert.deepEqual(planSizeProblems('documents/plans/x/log.md', 'a'.repeat(20000)), []);
});

test('history language ratchets in comments of code and anywhere in docs', () => {
  assert.equal(historyProblems(SRC, '// It was replaced by x.\n', '').length, 1);
  assert.deepEqual(historyProblems(SRC, 'const legacy = 1;\n', ''), []);
  assert.deepEqual(historyProblems(SRC, '// pdf.js legacy build\n', ''), []);
  assert.deepEqual(historyProblems(SRC, '// previously a\n', '// previously b\n'), []);
  assert.equal(historyProblems('documents/guide.md', 'It used to work.\n', null).length, 1);
  assert.deepEqual(historyProblems('documents/plans/x/plan.md', 'It used to work.\n', null), []);
});

test('suppressions ratchet: ts-ignore without reason, eslint-disable, skip, empty catch', () => {
  assert.equal(suppressionProblems(SRC, '// @ts-ignore\n', '').length, 1);
  assert.deepEqual(suppressionProblems(SRC, '// @ts-expect-error: narrowing is intended\n', ''), []);
  assert.equal(suppressionProblems(SRC, '// eslint-disable-next-line\n', '').length, 1);
  assert.equal(suppressionProblems('packages/core/__tests__/a.test.ts', "it.skip('a', () => {});\n", '').length, 1);
  assert.equal(suppressionProblems(SRC, 'try {\n g();\n} catch (e) {\n}\n', 'try { g(); } catch (e) { r(e); }\n').length, 1);
  assert.deepEqual(suppressionProblems(SRC, '// eslint-disable-next-line\n', '// eslint-disable-line\n'), []);
});

test('commented-out code and app CSS literals ratchet', () => {
  assert.equal(commentedCodeProblems(SRC, '// const y = 2;\n', '').length, 1);
  assert.deepEqual(commentedCodeProblems(SRC, '// const y = 2;\n', '// const y = 2;\n'), []);
  assert.equal(cssLiteralProblems('packages/browser/src/a.css', '.a { color: #ff0000; }\n', '.a { color: var(--ls-fg); }\n').length, 1);
  assert.deepEqual(cssLiteralProblems('packages/core/src/tokens.css', ':root { --ls-fg: #111; }\n', ''), []);
});

test('a new source file needs a header comment; the wording is free', () => {
  assert.equal(headerProblems(SRC, 'export const x = 1;\n', null).length, 1);
  assert.deepEqual(headerProblems(SRC, '// PubMed client: record lookup by PMID.\nexport const x = 1;\n', null), []);
  assert.deepEqual(headerProblems(SRC, '// Handlers for the popup messages.\nexport const x = 1;\n', null), []);
  assert.deepEqual(headerProblems(SRC, '\n/**\n * Parses things.\n */\nexport const x = 1;\n', null), []);
  assert.deepEqual(headerProblems('packages/core/src/a.css', '/* Styles rows. */\n.a {}\n', null), []);
  assert.deepEqual(headerProblems(SRC, 'export const x = 1;\n', '// Existing.\n'), []);
  assert.match(headerProblems(SRC, 'export const x = 1;\n', null)[0], /Parses and checks the project file/);
});

test('a new test mirrors a file, an index or a whole folder', () => {
  const test_ = 'packages/core/__tests__/a/b.test.ts';
  assert.equal(testMirrorProblems(test_, null, existsIn()).length, 1);
  for (const source of ['packages/core/src/a/b.ts', 'packages/core/src/a/b.tsx', 'packages/core/src/a/b.css', 'packages/core/src/a/b/index.ts', 'packages/core/src/a/b']) {
    assert.deepEqual(testMirrorProblems(test_, null, existsIn(source)), [], source);
  }
  assert.deepEqual(testMirrorProblems(test_, '// existing\n', existsIn()), []);
});

test('a deleted test is reported only while its code still exists', () => {
  const gone = 'packages/core/__tests__/a/b.test.ts';
  assert.deepEqual(deletedTestProblems([gone], existsIn()), []);
  assert.match(deletedTestProblems([gone], existsIn('packages/core/src/a/b.ts'))[0], /its code still exists; delete the test only together with the code/);
  assert.equal(deletedTestProblems([gone], existsIn('packages/core/src/a/b')).length, 1);
  assert.deepEqual(deletedTestProblems(['packages/core/__tests__/a/helper.ts'], existsIn('packages/core/src/a/helper.ts')), []);
});

test('CONTRACT anchors are checked with the doc slug rules', () => {
  const tag = 'CONTR' + 'ACT';
  const doc = '# Sync\n\n## Conflict resolution\n';
  const read = (name) => (name === 'sync.md' ? doc : null);
  assert.deepEqual(contractProblems(SRC, `// ${tag}: documents/contracts/sync.md#conflict-resolution\n`, null, read), []);
  assert.match(contractProblems(SRC, `// ${tag}: documents/contracts/sync.md#nope\n`, null, read)[0], /anchor '#nope'/);
  assert.match(contractProblems(SRC, `// ${tag}: documents/contracts/other.md#a\n`, null, read)[0], /does not exist/);
  const line = `// ${tag}: documents/contracts/sync.md#nope\n`;
  assert.deepEqual(contractProblems(SRC, line, line, read), [], 'an existing reference may stay');
});

test('checkFile calls the banned-word check for code files only', () => {
  const ctx = { exists: () => false, readContract: () => null };
  assert.ok(checkFile(SRC, '// Sample.\n// TODO: later\n', '// Sample.\n', ctx).some((p) => /TODO tag/.test(p)));
  assert.deepEqual(checkFile('README.md', 'TODO: later\n', 'TODO: later\n', ctx), []);
});

const sh = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'ignore' });

function repoWith(files, edit) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'sourceRules-')));
  sh(repo, 'init', '-q');
  sh(repo, 'config', 'user.email', 't@t.t');
  sh(repo, 'config', 'user.name', 't');
  const write = (rel, text) => {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  };
  for (const [rel, text] of Object.entries(files)) write(rel, text);
  sh(repo, 'add', '-A');
  sh(repo, 'commit', '-q', '-m', 'init');
  edit(repo, write);
  return repo;
}

const cli = (repo, ...args) => spawnSync('node', [script, ...args], { cwd: repo, encoding: 'utf8' });

test('CLI compares with HEAD and checks changed and untracked files when none are given', () => {
  const repo = repoWith({ 'packages/core/src/a.ts': '// A.\nexport const a = 1;\n' }, (_, write) => {
    write('packages/core/src/a.ts', '// A.\n// const b = 2;\nexport const a = 1;\n');
    write('packages/core/src/fresh.ts', 'export const c = 1;\n');
  });
  try {
    const result = cli(repo);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /a\.ts adds commented-out code/);
    assert.match(result.stderr, /fresh\.ts: new source file has no header/);
    assert.match(result.stdout, /source rules: 2 problems in 2 files/);
    assert.equal(cli(repo, 'packages/core/src/a.ts').status, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI reports a deleted test only while its code exists, and honours --base', () => {
  const files = {
    'packages/core/__tests__/kept.test.ts': "it('a', () => {});\n",
    'packages/core/src/kept.ts': '// Kept.\nexport const k = 1;\n',
    'packages/core/__tests__/gone.test.ts': "it('b', () => {});\n",
    'packages/core/src/gone.ts': '// Gone.\nexport const g = 1;\n',
  };
  const repo = repoWith(files, (dir) => {
    rmSync(join(dir, 'packages/core/__tests__/kept.test.ts'));
    rmSync(join(dir, 'packages/core/__tests__/gone.test.ts'));
    rmSync(join(dir, 'packages/core/src/gone.ts'));
  });
  try {
    const result = cli(repo);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /kept\.test\.ts was deleted but its code still exists/);
    assert.doesNotMatch(result.stderr, /gone\.test\.ts/);
    assert.equal(cli(repo, '--base', 'HEAD').status, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('CLI fails when the base revision does not exist instead of passing on nothing', () => {
  const repo = repoWith({ 'packages/core/src/a.ts': '// A.\nexport const a = 1;\n' }, () => {});
  try {
    const result = cli(repo, '--base', 'no-such-rev');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /base revision "no-such-rev" does not exist/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});
