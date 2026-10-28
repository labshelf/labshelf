// Pins the facts CLI on a small temp repo: where a name is defined, who calls it, who uses a file (through a barrel),
// the row cap, the query telemetry, and that no model package is involved.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A = 'packages/core/src/a.ts';
const B = 'packages/core/src/b.ts';
const C = 'packages/vscode/src/c.ts';
const D = 'packages/vscode/src/d.ts';

let root;
let spool;
let env;

const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const facts = (...args) => {
  const run = spawnSync(process.execPath, [join(CODE_DIR, 'facts.mjs'), ...args], { env, encoding: 'utf8' });
  return { status: run.status, out: run.stdout, err: run.stderr };
};
const events = () =>
  readdirSync(spool)
    .flatMap((file) => readFileSync(join(spool, file), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line));

before(() => {
  root = mkdtempSync(join(tmpdir(), 'labshelf-facts-'));
  spool = join(root, '.spool');
  env = { ...process.env, LABSHELF_FACTS_ROOT: root, LABSHELF_FACTS_DB: join(root, '.code-facts', 'facts.db'), LABSHELF_TELEMETRY_SPOOL: spool };
  delete env.LABSHELF_TELEMETRY;
  put('packages/core/package.json', JSON.stringify({ name: '@labshelf/core', version: '0.0.0', main: 'src/index.ts', types: 'src/index.ts' }));
  put(A, 'export function foo(x: number): number {\n  return x + 1;\n}\n\nexport function bar(): void {}\n\nfunction hidden(): string {\n  return "h";\n}\nexport const useHidden = () => hidden();\n');
  put('packages/core/src/index.ts', 'export { foo, bar } from "./a.js";\n');
  put(B, 'import { foo } from "./a.js";\n\nexport function runB(): number {\n  return foo(1);\n}\n');
  put(C, 'import { foo } from "@labshelf/core";\n\nexport function runC(): number {\n  return foo(2);\n}\n');
  put(D, `import { bar } from "@labshelf/core";\n\nexport function runD(): void {\n${Array.from({ length: 40 }, () => '  bar();').join('\n')}\n}\n`);
  // node_modules/@labshelf/core -> packages/core, as pnpm links a workspace package.
  mkdirSync(join(root, 'node_modules', '@labshelf'), { recursive: true });
  symlinkSync(join('..', '..', 'packages', 'core'), join(root, 'node_modules', '@labshelf', 'core'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const built = facts('build', '--quiet');
  assert.equal(built.status, 0, built.err);
});

after(() => rmSync(root, { recursive: true, force: true }));

test('def finds the declaration with kind, signature and visibility, and the re-export', () => {
  const { out } = facts('def', 'foo');
  assert.match(out, /^packages\/core\/src\/a\.ts:1 function foo \(x: number\): number \(exported\)$/m);
  assert.match(out, /^packages\/core\/src\/index\.ts:1 re-export of packages\/core\/src\/a\.ts$/m);
  assert.match(facts('def', 'hidden').out, /^packages\/core\/src\/a\.ts:7 function hidden \(\): string \(private\)$/m);
  assert.match(facts('def', 'nothingNamedThis').out, /\(no results\)/);
});

test('callers lists the call lines in b.ts and, through the package link, c.ts', () => {
  const { out } = facts('callers', 'foo');
  assert.match(out, /^packages\/core\/src\/b\.ts:4 runB -> foo/m);
  assert.match(out, /^packages\/vscode\/src\/c\.ts:4 runC -> foo/m);
});

test('uses lists importers, including the file that reaches it through the re-export', () => {
  const { out } = facts('uses', A);
  const importers = out.slice(out.indexOf('imported by:'));
  assert.match(importers, /packages\/core\/src\/b\.ts:1/);
  assert.match(importers, /packages\/vscode\/src\/c\.ts:1/);
});

test('40 hits print 30 rows and the number left out', () => {
  const { out } = facts('callers', 'bar');
  const rows = out.split('\n').filter((line) => line.startsWith(D));
  assert.equal(rows.length, 30);
  assert.match(out, /^\.\.\. 10 more/m);
});

test('each query emits index_query with its kind, rows and characters', () => {
  facts('callers', 'bar');
  const event = events().filter((item) => item.kind === 'index_query' && item.query_kind === 'callers').at(-1);
  assert.equal(event.results, 40);
  assert.ok(event.chars > 0);
});

test('the commands that needed a model are gone and no model package is imported', () => {
  assert.notEqual(facts('search', 'anything').status, 0);
  for (const file of readdirSync(CODE_DIR).filter((name) => name.endsWith('.mjs'))) {
    assert.doesNotMatch(readFileSync(join(CODE_DIR, file), 'utf8'), /@huggingface|oxc-parser|oxc-resolver/, file);
  }
});
