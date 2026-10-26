// Pins which file names, comment tags and emoji scripts/lint/bannedWords.mjs rejects.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findBannedWords } from '../bannedWords.mjs';

const SRC = 'packages/core/src/library';
const fails = (rel, text = '') => findBannedWords(rel, text).length > 0;

test('rejects grab-bag file names', () => {
  assert.ok(fails(`${SRC}/utils.ts`));
  assert.ok(fails(`${SRC}/stringHelpers.ts`));
  assert.ok(fails(`${SRC}/syncManager.ts`));
  assert.ok(fails(`${SRC}/common/index.ts`) === false, 'only the file name is checked');
});

test('accepts the Yjs UndoManager and the product LaTeX helper', () => {
  assert.equal(fails(`${SRC}/textUndoManager.ts`), false);
  assert.equal(fails(`${SRC}/latexHelper.ts`), false);
});

test('rejects history words as whole name words only', () => {
  assert.ok(fails(`${SRC}/legacyFormat.ts`));
  assert.ok(fails(`${SRC}/parserV2.ts`));
  assert.ok(fails(`${SRC}/old-reader.css`));
  assert.equal(fails(`${SRC}/fold.ts`), false);
  assert.equal(fails(`${SRC}/newPaper.ts`), false);
});

test('rejects comment tags outside the four allowed', () => {
  assert.ok(fails(`${SRC}/a.ts`, '  // TODO: later'));
  assert.ok(fails(`${SRC}/a.ts`, ' * FIXME broken'));
  assert.equal(fails(`${SRC}/a.ts`, '// TRAP: CrossRef returns 200 on a miss.'), false);
  assert.equal(fails(`${SRC}/a.ts`, 'const text = "// TODO write";'), false);
});

test('rejects emoji in sources but not in tests', () => {
  assert.ok(fails(`${SRC}/a.ts`, 'label: "\u{1F4C4} Paper"'));
  assert.equal(fails('packages/terminal/__tests__/screen/text.test.ts', 'width("\u{1F600}")'), false);
  assert.equal(fails(`${SRC}/a.ts`, 'const arrow = "→";'), false);
});
