// Pins the rank fusion and cosine ranking that `facts search` is built from.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { EMBED_MODEL, cosineRanking, fuse } from '../embed.mjs';

test('an item found by both lists outranks one found by a single list', () => {
  const fused = fuse([
    [{ kind: 'file', ref: 'a' }, { kind: 'file', ref: 'b' }],
    [{ kind: 'file', ref: 'c' }, { kind: 'file', ref: 'b' }],
  ]);
  assert.deepEqual(fused.map((item) => item.ref), ['b', 'a', 'c']);
});

test('items of different kinds with the same ref stay separate', () => {
  assert.equal(fuse([[{ kind: 'file', ref: 'x' }, { kind: 'module', ref: 'x' }]]).length, 2);
});

test('cosine ranking orders items by closeness to the query', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE embed_items (kind TEXT, ref TEXT, text_hash TEXT); CREATE TABLE embeddings (text_hash TEXT PRIMARY KEY, model TEXT, vector BLOB)');
  const put = (hash, vector) => db.prepare('INSERT INTO embeddings VALUES (?,?,?)').run(hash, EMBED_MODEL, new Uint8Array(Float32Array.from(vector).buffer));
  put('h1', [1, 0]);
  put('h2', [0.6, 0.8]);
  for (const [ref, hash] of [['far', 'h2'], ['near', 'h1']]) db.prepare('INSERT INTO embed_items VALUES (?,?,?)').run('file', ref, hash);
  assert.deepEqual(cosineRanking(db, Float32Array.from([1, 0]), 5).map((item) => item.ref), ['near', 'far']);
});
