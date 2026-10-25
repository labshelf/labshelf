// Pins what scripts/checks/namingRules.mjs and namingExports.mjs accept and reject, on a small fixture vocabulary, plus the real yaml's integrity.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { parseExports } from '../namingExports.mjs';
import { buildIndex, checkExportName, checkPath, loadVocabulary } from '../namingRules.mjs';

const vocab = {
  domains: { hash: { def: 'h' }, reader: { def: 'r', syn: ['viewer'] }, spaces: { def: 's' } },
  runtime: { node: { def: 'n' } },
  mechanism: {
    verbs: { create: { syn: ['make'] }, read: {} },
    nouns: { bytes: { def: 'b' }, connection: { def: 'c', syn: ['socket'] } },
    roles: { parser: 'p', store: { def: 's', syn: ['persistence'] } },
    uiParts: ['panel'],
    qualifiers: ['live'],
    connectors: ['of'],
    typeSuffixes: ['options', 'result'],
    namePatterns: { conversion: { form: ['to<to>', '<from>To<to>'], sides: ['subjects', 'nouns', 'formats', 'tools', 'compounds'] } },
  },
  formats: ['pdf', 'hex', 'base64', 'url'],
  subjects: { paper: { def: 'p' }, libraryRoot: { def: 'l' } },
  features: { space: { def: 's', home: ['**/spaces/**'], syn: ['room'], words: ['spaceDir'] } },
  tools: ['pdfjs'],
  compoundOnly: { root: { use: ['libraryRoot', 'buildRoot'] } },
  banned: { data: 'name what the data is', result: 'only as a type suffix' },
};
const index = buildIndex(vocab);
const path = (rel, options) => checkPath(index, `packages/core/src/${rel}`, options);
const exportRules = (name) => rules(checkExportName(index, name, 'function'));
const rules = (violations) => violations.map((violation) => violation.rule);

test('folder-case: camelCase segments only', () => {
  assert.deepEqual(path('hash/paper.ts'), []);
  assert.deepEqual(rules(path('hash/read-me/paper.ts')), ['folder-case']);
});

test('folder-term: top-level is a domain, deeper is one known term, tools never', () => {
  assert.deepEqual(path('node/parser/paper.ts'), []);
  assert.deepEqual(rules(path('stuffy/paper.ts')), ['folder-term']);
  assert.ok(rules(path('hash/livePaper/paper.ts')).includes('folder-term'));
  assert.ok(rules(path('hash/pdfjs/paper.ts')).includes('folder-term'));
  assert.deepEqual(path('hash/paper/pdfjsPaper.ts'), []);
});

test('a top-level folder that is a declared domain wins over a compoundOnly entry of the same word', () => {
  const clash = buildIndex({ ...vocab, domains: { ...vocab.domains, options: { def: 'o' } }, compoundOnly: { options: { use: ['optionsPage'] } } });
  const clashPath = (rel) => rules(checkPath(clash, `packages/browser/src/${rel}`));
  assert.deepEqual(clashPath('options/paper.ts'), []);
  assert.ok(clashPath('hash/options/paper.ts').includes('compound-only'));
  assert.deepEqual(rules(checkExportName(clash, 'readOptions', 'function')), ['compound-only']);
});

test('file-case: camelCase, or PascalCase for a class', () => {
  assert.deepEqual(rules(path('hash/PaperParser.ts')), ['file-case']);
  assert.deepEqual(path('hash/PaperParser.ts', { classFile: true }), []);
  assert.deepEqual(rules(path('hash/paper_parser.ts')), ['file-case']);
});

test('free-words: one unknown word is fine, two are not', () => {
  assert.deepEqual(path('hash/paperZorp.ts'), []);
  assert.deepEqual(rules(path('hash/paperZorpQuux.ts')), ['free-words']);
});

test('synonym, banned and compound-only names', () => {
  assert.equal(path('hash/paperViewer.ts')[0].hint, 'use reader');
  assert.deepEqual(rules(path('hash/paperData.ts')), ['banned']);
  assert.deepEqual(path('hash/buildRoot.ts'), []);
  const bare = path('hash/root.ts')[0];
  assert.equal(bare.rule, 'compound-only');
  assert.match(bare.hint, /use one of libraryRoot, buildRoot/);
});

test('feature-home: a feature term only under its home', () => {
  assert.deepEqual(path('spaces/parser/space.ts'), []);
  assert.deepEqual(rules(path('hash/space.ts')), ['feature-home']);
});

test('feature syn is reported as a synonym, and a feature word keeps the feature home', () => {
  assert.equal(path('spaces/paperRoom.ts')[0].rule, 'synonym');
  assert.equal(path('spaces/paperRoom.ts')[0].hint, 'use space');
  assert.deepEqual(path('spaces/spaceDir.ts'), []);
  assert.deepEqual(rules(path('hash/spaceDir.ts')), ['feature-home']);
});

test('mechanism nouns are valid anywhere, as folders too, and carry synonyms', () => {
  assert.deepEqual(path('hash/connection/paper.ts'), []);
  assert.deepEqual(path('hash/bytes/paper.ts'), []);
  assert.equal(path('hash/paperSocket.ts')[0].hint, 'use connection');
});

test('export-verb: functions start with a verb; a verb synonym reports synonym', () => {
  assert.deepEqual(checkExportName(index, 'createPaper', 'function'), []);
  assert.deepEqual(rules(checkExportName(index, 'paperCreate', 'function')), ['export-verb']);
  assert.deepEqual(rules(checkExportName(index, 'makePaper', 'function')), ['synonym']);
});

test('conversion: <from>To<to> and to<to> need vocabulary terms on every side', () => {
  for (const name of ['bytesToHex', 'hexToBytes', 'bytesToBase64Url', 'toHex', 'pdfjsToBuildRoot', 'bytesToPaper']) assert.deepEqual(exportRules(name), [], name);
  const unknown = checkExportName(index, 'fooToHex', 'function');
  assert.deepEqual(rules(unknown), ['conversion']);
  assert.match(unknown[0].message, /from side "foo" is not a vocabulary term/);
  assert.deepEqual(exportRules('bytesToFoo'), ['conversion']);
  assert.deepEqual(exportRules('toFoo'), ['conversion']);
  assert.deepEqual(exportRules('bytesToFooBar'), ['conversion']);
  assert.deepEqual(exportRules('createBytesToHex'), []);
});

test('conversion: a name with To outside the form falls through to export-verb', () => {
  for (const name of ['bytesTo', 'toToBytes', 'bytesToHexToBytes', 'sha256Hex']) assert.deepEqual(exportRules(name), ['export-verb'], name);
});

test('type names: suffix allowed only last in a multi-word name; I prefix stripped', () => {
  assert.deepEqual(checkExportName(index, 'PaperResult', 'type'), []);
  assert.deepEqual(rules(checkExportName(index, 'Result', 'type')), ['banned']);
  assert.deepEqual(checkExportName(index, 'IPaperParser', 'interface'), []);
  assert.deepEqual(rules(checkExportName(index, 'PaperZorpQuux', 'class')), ['free-words']);
});

test('parseExports lists exported declarations only', () => {
  const text = 'export function a() {}\nexport const b = () => 1;\nexport const c = 3;\nconst d = () => 1;\nexport class E {}\nexport interface F {}\nexport type G = 1;\nexport enum H { x }';
  const found = parseExports(text, 'x.ts').map((item) => `${item.kind}:${item.name}`);
  assert.deepEqual(found, ['function:a', 'function:b', 'class:E', 'interface:F', 'type:G', 'enum:H']);
});

test('the real vocabulary loads and no synonym equals a term key', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
  const real = loadVocabulary(resolve(root, 'scripts/checks/vocabulary.yaml'));
  assert.ok(real.words.size > 500);
  const { parse } = createRequire(resolve(root, 'packages/core/package.json'))('yaml');
  const v = parse(readFileSync(resolve(root, 'scripts/checks/vocabulary.yaml'), 'utf8'));
  const m = v.mechanism;
  assert.equal(v.subjects.details, undefined);
  assert.equal(v.domains.details, undefined);
  const keys = new Set([...Object.keys(v.domains), ...Object.keys(v.runtime), ...Object.keys(m.verbs), ...Object.keys(m.roles), ...Object.keys(m.nouns), ...m.uiParts, ...m.qualifiers, ...m.connectors, ...m.typeSuffixes, ...v.formats, ...Object.keys(v.subjects), ...Object.keys(v.features), ...v.tools, ...Object.keys(v.compoundOnly), ...Object.keys(v.banned)]);
  const sections = [v.domains, v.runtime, v.subjects, m.nouns, m.roles, m.verbs, v.features];
  const clashes = sections.flatMap((section) => Object.values(section).flatMap((value) => value?.syn ?? [])).filter((syn) => keys.has(syn));
  assert.deepEqual(clashes, []);
});


const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const real = loadVocabulary(resolve(root, 'scripts/checks/vocabulary.yaml'));
const realPath = (rel) => rules(checkPath(real, `packages/core/src/${rel}`));

test('the real vocabulary declares the conversion pattern, so removing it fails this test', () => {
  assert.deepEqual(real.namePatterns.map((pattern) => pattern.rule), ['conversion']);
  for (const name of ['bytesToHex', 'base64ToBytes', 'bytesToBase64Url', 'paperRecordToMetadata', 'toMetadata']) assert.deepEqual(checkExportName(real, name, 'function'), [], name);
  assert.deepEqual(rules(checkExportName(real, 'fooToHex', 'function')), ['conversion']);
  assert.deepEqual(rules(checkExportName(real, 'sha256Hex', 'function')), ['export-verb']);
});

test('readingStatus lives under library/readingStatus; its feature words are specific to it', () => {
  assert.deepEqual(realPath('library/readingStatus/unreadPaper.ts'), []);
  assert.deepEqual(realPath('library/readingStatus/readingStatus.ts'), []);
  assert.ok(realPath('hash/readingStatus.ts').includes('feature-home'));
  assert.ok(realPath('hash/unreadPaper.ts').includes('feature-home'));
  assert.ok(!realPath('templates/dom/publishDone.ts').includes('feature-home'));
});
