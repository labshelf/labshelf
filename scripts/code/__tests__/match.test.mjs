// Pins the clone matching shared by `facts similar` and the dup-guard hook: units of a source text with owners and lines,
// and the indexed units that match a fingerprint (exact T1/T2, shingle similarity, other files only, small units left out).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { matchPrint, unitsOfSource } from '../match.mjs';

const CODE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const A = 'packages/core/src/a.ts';
const TEXT = 'packages/core/src/text.ts';
const OTHER = 'packages/vscode/src/other.ts';

const ORIGINAL = `export interface Entry {
  id: string;
  title: string;
}

export function summarizeEntries(entries: readonly Entry[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const key = entry.title.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= limit) break;
    out.push(\`\${entry.id}: \${key}\`);
  }
  return out;
}
`;
const RENAMED = `export function digest(items: readonly { id: string; title: string }[], max: number): string[] {
  const done = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const label = item.title.trim().toLowerCase();
    if (done.has(label)) continue;
    done.add(label);
    if (result.length >= max) break;
    result.push(\`\${item.id}: \${label}\`);
  }
  return result;
}
`;
const UNRELATED = `export function clampAll(values: number[], low: number, high: number): number[] {
  const clamped: number[] = [];
  for (const value of values) {
    if (value < low) clamped.push(low);
    else if (value > high) clamped.push(high);
    else clamped.push(value);
  }
  return clamped.sort((x, y) => x - y);
}
`;

let root;
let db;

const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'labshelf-match-'));
  const env = { ...process.env, LABSHELF_FACTS_ROOT: root, LABSHELF_FACTS_DB: join(root, '.code-facts', 'facts.db'), LABSHELF_TELEMETRY: 'off' };
  put('packages/core/package.json', JSON.stringify({ name: '@labshelf/core', version: '0.0.0', main: 'src/index.ts', types: 'src/index.ts' }));
  put('packages/core/src/index.ts', 'export { foo } from "./a.js";\n');
  put(A, 'export function foo(x: number): number {\n  return x + 1;\n}\n');
  put(TEXT, ORIGINAL);
  put(OTHER, `${RENAMED}\n${UNRELATED}`);
  mkdirSync(join(root, 'node_modules', '@labshelf'), { recursive: true });
  symlinkSync(join('..', '..', 'packages', 'core'), join(root, 'node_modules', '@labshelf', 'core'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const built = spawnSync(process.execPath, [join(CODE_DIR, 'facts.mjs'), 'build', '--quiet'], { env, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
  db = new DatabaseSync(join(root, '.code-facts', 'facts.db'), { readOnly: true });
});

after(() => {
  db?.close();
  rmSync(root, { recursive: true, force: true });
});

test('unitsOfSource returns functions, named arrows and methods as Owner.method with lines and fingerprints', () => {
  const text = `export function plain(a: number): number {
  return a * 2;
}

const arrow = (b: string) => b.trim();

class Box {
  size(): number {
    return 1;
  }
  get label(): string {
    return "x";
  }
}

const api = {
  run() {
    return 2;
  },
};

declare function ambient(): void;
useIt(() => 1);
`;
  const units = unitsOfSource('x.ts', text);
  assert.deepEqual(
    units.map((unit) => [unit.label, unit.name, unit.owner, unit.startLine, unit.endLine]),
    [
      ['plain', 'plain', '', 1, 3],
      ['arrow', 'arrow', '', 5, 5],
      ['Box.size', 'size', 'Box', 8, 10],
      ['Box.label', 'label', 'Box', 11, 13],
      ['api.run', 'run', 'api', 17, 19],
    ],
  );
  for (const unit of units) {
    assert.ok(unit.print.nodes > 0);
    assert.match(unit.print.t1, /^[0-9a-f]{16}$/);
    assert.ok(unit.print.shingles instanceof Uint32Array);
  }
});

test('unitsOfSource reads tsx and gives the same fingerprint as the indexed unit', () => {
  const [unit] = unitsOfSource(TEXT, ORIGINAL);
  assert.equal(unit.label, 'summarizeEntries');
  assert.deepEqual([unit.startLine, unit.endLine], [6, 17]);
  const row = db.prepare('SELECT uf.t1, uf.t2, uf.nodes FROM units u JOIN unit_facts uf ON uf.id = u.id WHERE u.file = ? AND u.name = ?').get(TEXT, 'summarizeEntries');
  assert.deepEqual([unit.print.t1, unit.print.t2, unit.print.nodes], [row.t1, row.t2, row.nodes]);
  assert.equal(unitsOfSource('view.tsx', 'export const View = () => <div>{[1, 2].map((n) => n)}</div>;\n').length, 1);
});

test('an unchanged unit matches its indexed twin exactly, with the same name flagged', () => {
  const [unit] = unitsOfSource('packages/vscode/src/copy.ts', ORIGINAL);
  const hits = matchPrint(db, unit.print, { excludeFile: 'packages/vscode/src/copy.ts', name: unit.label });
  assert.equal(hits[0].unit.file, TEXT);
  assert.equal(hits[0].exact, 'T1');
  assert.equal(hits[0].similarity, 1);
  assert.equal(hits[0].sameName, true);
  assert.equal(hits.filter((hit) => hit.sameName).length, 1);
});

test('a renamed copy is a T2 hit at similarity 1 on the original, and the other file is the only exclusion', () => {
  const [unit] = unitsOfSource('packages/vscode/src/copy.ts', RENAMED);
  const hits = matchPrint(db, unit.print, { excludeFile: 'packages/vscode/src/copy.ts', name: unit.label });
  const original = hits.find((hit) => hit.unit.file === TEXT);
  assert.deepEqual([original.exact, original.similarity, original.sameName], ['T2', 1, false]);
  const onlyOthers = matchPrint(db, unit.print, { excludeFile: OTHER, name: unit.label });
  assert.ok(onlyOthers.every((hit) => hit.unit.file !== OTHER));
  assert.ok(onlyOthers.some((hit) => hit.unit.file === TEXT));
});

test('an unrelated function has no exact hit and a low similarity; units under 10 nodes are never returned', () => {
  const [unit] = unitsOfSource('packages/vscode/src/copy.ts', UNRELATED);
  // The same text is indexed in OTHER (as an exact twin); with that file excluded nothing else resembles it.
  assert.equal(matchPrint(db, unit.print, { excludeFile: 'packages/vscode/src/copy.ts' })[0].exact, 'T1');
  const hits = matchPrint(db, unit.print, { excludeFile: OTHER });
  assert.ok(hits.every((hit) => !hit.exact && hit.similarity < 0.5));
  assert.ok(hits.every((hit) => hit.unit.nodes >= 10));
  assert.ok(!hits.some((hit) => hit.unit.name === 'foo'));
  const [small] = unitsOfSource('s.ts', 'export function foo(x: number): number {\n  return x + 1;\n}\n');
  assert.equal(matchPrint(db, small.print, { excludeFile: 's.ts' }).some((hit) => hit.unit.name === 'foo'), false);
});

test('excludeId drops one unit and hits sort exact first, then by similarity', () => {
  const [unit] = unitsOfSource(TEXT, ORIGINAL);
  const all = matchPrint(db, unit.print);
  assert.equal(all[0].unit.file, TEXT);
  assert.ok(all.every((hit, i) => i === 0 || Boolean(all[i - 1].exact) >= Boolean(hit.exact)));
  const rest = matchPrint(db, unit.print, { excludeId: all[0].unit.id });
  assert.ok(rest.every((hit) => hit.unit.id !== all[0].unit.id));
  assert.equal(rest.length, all.length - 1);
});
