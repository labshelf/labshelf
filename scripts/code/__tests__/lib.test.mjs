// Pins the path rules and text helpers the code-facts database is built from: module and runtime of a file, file
// headers, comment tags, test mirrors, name splitting and the full-text query.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fnv, ftsQuery, headerOf, jaccard, mirrorSourcesOf, moduleOf, multisetOverlap, runtimeOf, shingleSet, splitTopLevel, splitWords, tagsOf, typeKey, unitSearchText } from '../lib.mjs';

test('a file belongs to its folder, and runtime folders belong to the enclosing module', () => {
  assert.equal(moduleOf('packages/core/src/path/pathOps.ts'), 'packages/core/src/path');
  assert.equal(moduleOf('packages/core/src/path/node/nodePath.ts'), 'packages/core/src/path');
  assert.equal(moduleOf('packages/core/src/library/sync/dom/worker/a.ts'), 'packages/core/src/library/sync');
  assert.equal(moduleOf('packages/core/src/index.ts'), 'packages/core/src');
  assert.equal(moduleOf('packages/vscode/src/node/x.ts'), 'packages/vscode/src', 'a runtime folder under src belongs to src');
});

test('runtime follows runtime folders, then the package default', () => {
  assert.equal(runtimeOf('packages/core/src/path/pathOps.ts'), 'neutral');
  assert.equal(runtimeOf('packages/core/src/path/node/nodePath.ts'), 'node');
  assert.equal(runtimeOf('packages/core/src/relay/worker/a.ts'), 'worker');
  assert.equal(runtimeOf('packages/vscode/src/reader/webview/readerEntry.ts'), 'webview');
  assert.equal(runtimeOf('packages/vscode/src/library/commands.ts'), 'vscode-host');
  assert.equal(runtimeOf('packages/browser/src/background/entry.ts'), 'worker');
  assert.equal(runtimeOf('packages/terminal/src/cli/run.ts'), 'node');
});

test('the header is the leading comment block, cut at a sentence end within 300 characters', () => {
  assert.equal(headerOf('// Parses the project file.\n// Second line.\nimport x;\n'), 'Parses the project file. Second line.');
  assert.equal(headerOf('/** Declares PathOps. */\n\nexport {};\n'), 'Declares PathOps.');
  assert.equal(headerOf('#!/usr/bin/env node\n// Runs it.\n'), 'Runs it.');
  assert.equal(headerOf('export const a = 1;\n// late\n'), '');
  const long = `// ${'Word '.repeat(50)}ends. ${'More '.repeat(40)}text.\n`;
  assert.ok(headerOf(long).endsWith('ends.'));
});

test('tags keep their continuation lines', () => {
  const text = 'const a = 1;\n  // TRAP: first line\n  // goes on here.\nconst b = 2;\n/** INVARIANT: sorted. */\n// CONTRACT: x.md#y\n';
  assert.deepEqual(tagsOf(text), [
    { line: 2, tag: 'TRAP', text: 'first line goes on here.' },
    { line: 5, tag: 'INVARIANT', text: 'sorted.' },
    { line: 6, tag: 'CONTRACT', text: 'x.md#y' },
  ]);
});

test('a test mirrors the source file at the same path under src', () => {
  assert.deepEqual(mirrorSourcesOf('packages/core/__tests__/path/isInside.test.ts'), [
    'packages/core/src/path/isInside.ts',
    'packages/core/src/path/isInside.tsx',
  ]);
  assert.deepEqual(mirrorSourcesOf('packages/core/__tests__/fixtures/data.ts'), []);
});

test('names split at camel case, digits and path separators', () => {
  assert.equal(splitWords('hostPacer'), 'host pacer');
  assert.equal(splitWords('packages/core/src/path/pathOps.ts'), 'packages core src path path ops ts');
  assert.equal(splitWords('parseURLQuery2'), 'parse url query 2');
});

test('the query ORs the quoted, split words and drops stop words', () => {
  assert.equal(ftsQuery('pace downloads per host'), '"pace" OR "downloads" OR "host"');
  assert.equal(ftsQuery('hostPacer "x"'), '"host" OR "pacer" OR "x"');
  assert.equal(ftsQuery('the of'), '');
});

test('a build lock is held by one process at a time, and a lock left by a dead process is taken over', async () => {
  const { mkdtempSync, writeFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { acquireLock } = await import('../lib.mjs');
  const path = join(mkdtempSync(join(tmpdir(), 'facts-lock-')), 'build.lock');
  const release = acquireLock(path);
  assert.equal(typeof release, 'function');
  assert.equal(acquireLock(path), null, 'a second build waits for the first');
  release();
  assert.equal(existsSync(path), false);
  writeFileSync(path, '999999999');
  const again = acquireLock(path);
  assert.equal(typeof again, 'function', 'a dead owner does not block the next build');
  again();
});

test('shingles and Jaccard: identical streams are 1, disjoint are 0, a short stream is one shingle', () => {
  const a = shingleSet(['a', 'b', 'c', 'd', 'e']);
  assert.equal(a.length, 2);
  assert.equal(jaccard(a, shingleSet(['a', 'b', 'c', 'd', 'e'])), 1);
  assert.equal(jaccard(a, shingleSet(['x', 'y', 'z', 'w'])), 0);
  assert.equal(jaccard(a, shingleSet(['a', 'b', 'c', 'd'])), 0.5);
  assert.equal(shingleSet(['a', 'b']).length, 1);
  assert.equal(fnv('a'), fnv('a'));
});

test('types compare without spaces or readonly, and type lists split only at top-level commas', () => {
  assert.equal(typeKey('readonly string[]'), 'string[]');
  assert.equal(typeKey('Map<string, number>'), 'map<string,number>');
  assert.deepEqual(splitTopLevel('Map<a, b>, (x: c, y: d) => e, string'), ['Map<a, b>', '(x: c, y: d) => e', 'string']);
});

test('parameter types match as a multiset, in any order', () => {
  assert.equal(multisetOverlap(['string', 'string'], ['string', 'number', 'string']), 2);
  assert.equal(multisetOverlap(['string', 'string'], ['string', 'number']), 1);
});

test('the unit search text holds name words, visibility, types, calls, comment and strings', () => {
  const text = unitSearchText({
    name: 'hostOf', owner: '', kind: 'function', exported: 0, signature: '(url: string): string', doc: '', comment: 'The host of a url.',
    params: ['string'], returns: 'string', calls: ['URL'], literals: ['https:'], header: 'Url helpers.',
  });
  assert.equal(text.name, 'host of');
  assert.match(text.types, /private string string/);
  assert.equal(text.calls, 'url');
  assert.match(text.text, /The host of a url\..*https:/);
});
