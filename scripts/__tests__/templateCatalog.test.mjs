// Pins the standalone validate.mjs and build-index.mjs that scripts/template-catalog.mjs emits for the catalog repository.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const generator = join(dirname(fileURLToPath(import.meta.url)), '..', 'template-catalog.mjs');
const COMMIT = '3f2c9a1b4d5e6f708192a3b4c5d6e7f801234567';

const write = (root, rel, content) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
};

const manifest = (id, main = 'main.tex') =>
  `schema: 1\nid: ${id}\nname: Sample\ndescription: A sample template.\ncategory: article\nformat: latex\nengine: pdflatex\nmain: ${main}\nlicense: MIT\nauthors: [Jane Doe]\n`;

function png(width, size = 100) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0);
  ihdr.write('IHDR', 4, 'ascii');
  ihdr.writeUInt32BE(width, 8);
  ihdr.writeUInt32BE(300, 12);
  const head = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
  return Buffer.concat([head, Buffer.alloc(Math.max(0, size - head.length))]);
}

function addTemplate(root, id) {
  write(root, `templates/${id}/template.yaml`, manifest(id));
  write(root, `templates/${id}/files/main.tex`, `\\documentclass{article} % ${id}\n`);
  write(root, `templates/${id}/preview/thumbnail.png`, png(800));
  write(root, `templates/${id}/preview/sample.pdf`, '%PDF-1.5\n%%EOF\n');
}

const goodCatalog = (...ids) => {
  const root = mkdtempSync(join(tmpdir(), 'catalog-good-'));
  for (const id of ids) addTemplate(root, id);
  return root;
};

// One template with a bad manifest, one with a latexmkrc, one with an oversized thumbnail.
function badCatalog() {
  const root = goodCatalog('fine', 'bad-manifest', 'bad-path', 'bad-image');
  write(root, 'templates/bad-manifest/template.yaml', manifest('bad-manifest').replace('license: MIT\n', ''));
  write(root, 'templates/bad-path/files/latexmkrc', "system('id');\n");
  write(root, 'templates/bad-image/preview/thumbnail.png', png(800, 600 * 1024));
  return root;
}

function emitScripts() {
  const outDir = mkdtempSync(join(tmpdir(), 'catalog-scripts-'));
  const result = spawnSync(process.execPath, [generator, outDir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return outDir;
}

const run = (outDir, script, cwd, ...args) =>
  spawnSync(process.execPath, [join(outDir, script), ...args], { cwd, encoding: 'utf8' });

test('writes validate.mjs and build-index.mjs into the output folder', () => {
  const outDir = emitScripts();
  assert.ok(readFileSync(join(outDir, 'validate.mjs'), 'utf8').length > 0);
  assert.ok(readFileSync(join(outDir, 'build-index.mjs'), 'utf8').length > 0);
});

test('validate.mjs exits 0 on a good catalog', () => {
  const result = run(emitScripts(), 'validate.mjs', goodCatalog('alpha', 'beta'));
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('validate.mjs names each broken template and exits non-zero', () => {
  const result = run(emitScripts(), 'validate.mjs', badCatalog());
  assert.notEqual(result.status, 0);
  const output = result.stdout + result.stderr;
  for (const id of ['bad-manifest', 'bad-path', 'bad-image']) assert.match(output, new RegExp(id));
  assert.doesNotMatch(output, /\bfine\b/);
});

test('validate.mjs exits non-zero when templates/ is missing', () => {
  const result = run(emitScripts(), 'validate.mjs', mkdtempSync(join(tmpdir(), 'catalog-empty-')));
  assert.notEqual(result.status, 0);
});

test('build-index.mjs writes the same index.json on two runs', () => {
  const outDir = emitScripts();
  const catalog = goodCatalog('beta', 'alpha');
  assert.equal(run(outDir, 'build-index.mjs', catalog, '--commit', COMMIT).status, 0);
  const first = readFileSync(join(catalog, 'index.json'), 'utf8');
  assert.equal(run(outDir, 'build-index.mjs', catalog, '--commit', COMMIT).status, 0);
  assert.equal(readFileSync(join(catalog, 'index.json'), 'utf8'), first);
  const index = JSON.parse(first);
  assert.equal(index.commit, COMMIT);
  assert.deepEqual(index.templates.map((t) => t.id), ['alpha', 'beta']);
  assert.ok(first.endsWith('\n'));
});

test('build-index.mjs exits non-zero on a bad catalog and writes no index', () => {
  const catalog = badCatalog();
  const result = run(emitScripts(), 'build-index.mjs', catalog, '--commit', COMMIT);
  assert.notEqual(result.status, 0);
  assert.throws(() => readFileSync(join(catalog, 'index.json')));
});
