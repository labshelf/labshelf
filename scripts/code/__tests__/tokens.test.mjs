// Pins the clone fingerprints `facts similar` compares: locals renamed or flattened, a pasted body matching its function.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { jaccard } from '../lib.mjs';
import { snippetFingerprint } from '../tokens.mjs';

const always = () => true;

test('renaming locals keeps T2 and the flat shingles but changes T1', () => {
  const a = snippetFingerprint('function f(a, b) { const r = rel(a, b); return r !== "" && !r.startsWith(".."); }', always);
  const b = snippetFingerprint('function g(x, y) { const out = rel(x, y); return out !== "" && !out.startsWith(".."); }', always);
  assert.notEqual(a.t1, b.t1);
  assert.equal(a.t2, b.t2);
  assert.equal(jaccard(a.shingles, b.shingles), 1);
});

test('a pasted body has the body hash of its function, with undeclared names judged by isLocalName', () => {
  const unit = snippetFingerprint('const f = (a, b) => { const r = path.relative(a, b); return !r.startsWith(".."); };', always);
  const body = snippetFingerprint('const r = path.relative(x, y); return !r.startsWith("..");', (name) => name !== 'path');
  assert.equal(body.bodyT2, unit.bodyT2);
  assert.ok(jaccard(body.shingles, unit.shingles) > 0.6);
});

test('a free name stays a name, so a different import is a different stream', () => {
  const a = snippetFingerprint('return path.relative(a, b);', (name) => name !== 'path');
  const b = snippetFingerprint('return url.relative(a, b);', (name) => name !== 'url');
  assert.notEqual(a.t2, b.t2);
});
