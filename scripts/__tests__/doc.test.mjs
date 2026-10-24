// Pins how scripts/doc.mjs slugs headings and cuts one section out of a document.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractSection, listHeadings, slugify } from '../doc.mjs';

const DOC = ['# Sync', '', 'Intro.', '', '## Conflict resolution', 'Keep both.', '', '### Ties', 'Newest wins.', '', '## Write records', 'One per write.'].join('\n');

test('slugs headings the way GitHub anchors them', () => {
  assert.equal(slugify('Conflict resolution'), 'conflict-resolution');
  assert.equal(slugify('Ports and composition roots (VS Code)'), 'ports-and-composition-roots-vs-code');
});

test('a section runs to the next heading of the same or a higher level', () => {
  assert.equal(extractSection(DOC, 'conflict-resolution'), '## Conflict resolution\nKeep both.\n\n### Ties\nNewest wins.');
  assert.equal(extractSection(DOC, 'write-records'), '## Write records\nOne per write.');
});

test('an unknown anchor returns null', () => {
  assert.equal(extractSection(DOC, 'missing'), null);
});

test('headings list with their anchors, indented by level', () => {
  assert.deepEqual(listHeadings(DOC), ['Sync  #sync', '  Conflict resolution  #conflict-resolution', '    Ties  #ties', '  Write records  #write-records']);
});
