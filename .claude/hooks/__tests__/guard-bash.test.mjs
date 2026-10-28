// Pins the guard-bash hook: raw test, typecheck and build commands are denied with the run.mjs equivalent, everything else passes.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const hook = new URL('../guard-bash.mjs', import.meta.url).pathname;

const stateDir = mkdtempSync(join(tmpdir(), 'guard-bash-'));
const env = { ...process.env, CLAUDE_PROJECT_DIR: '/repo', LABSHELF_HOOK_STATE_DIR: stateDir };
let sessions = 0;
const newSession = () => `s${++sessions}`;

function run(command, input = { session_id: newSession(), tool_name: 'Bash', tool_input: { command } }) {
  const result = spawnSync('node', [hook], { input: typeof input === 'string' ? input : JSON.stringify(input), encoding: 'utf8', env });
  assert.equal(result.status, 0);
  return result.stdout.trim() ? JSON.parse(result.stdout).hookSpecificOutput : null;
}

function assertDenied(command, equivalent, prefix = /^Use: node scripts\/agents\/run\.mjs /) {
  const output = run(command);
  assert.ok(output, `expected deny for: ${command}`);
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.match(output.permissionDecisionReason, prefix);
  if (equivalent) assert.ok(output.permissionDecisionReason.includes(equivalent), `${output.permissionDecisionReason} lacks ${equivalent}`);
}

test('denies a raw core test and names the wrapper command', () => {
  assertDenied('pnpm --filter @labshelf/core test -- x', 'node scripts/agents/run.mjs test core -- x');
});

test('denies typecheck and build with the package folder', () => {
  assertDenied('pnpm --filter @labshelf/browser typecheck', 'node scripts/agents/run.mjs typecheck browser');
  assertDenied('pnpm --filter=@labshelf/vscode build', 'node scripts/agents/run.mjs build vscode');
});

test('denies pnpm test, pnpm test:tooling, jest, tsc and node --test', () => {
  assertDenied('pnpm test');
  assertDenied('pnpm test:tooling', 'node scripts/agents/run.mjs test tooling');
  assertDenied('npx jest packages/core');
  assertDenied('pnpm exec tsc --noEmit');
  assertDenied('FOO=1 jest');
  assertDenied('node --test scripts/**/*.test.mjs', 'node scripts/agents/run.mjs test tooling');
});

test('denies a raw command inside a chain', () => {
  assertDenied('cd packages/core && pnpm --filter @labshelf/core test -- y | tail -5', 'node scripts/agents/run.mjs test core -- y');
  assertDenied('echo start; tsc -p .');
});

test('allows pnpm gate, run.mjs calls and unrelated commands', () => {
  assert.equal(run('pnpm gate --no-lint'), null);
  assert.equal(run('node scripts/agents/run.mjs test core -- x'), null);
  assert.equal(run('node scripts/agents/run.mjs cmd -- pnpm --filter @labshelf/browser build:chrome'), null);
  assert.equal(run('git status && ls'), null);
  assert.equal(run('pnpm --filter @labshelf/browser build:chrome'), null);
});

test('ignores raw commands that are only text', () => {
  assert.equal(run('rg -n "pnpm test" .claude'), null);
  assert.equal(run('git commit -m "run jest && tsc"'), null);
});

test('never fails on bad input', () => {
  assert.equal(run('', 'not json'), null);
  assert.equal(run('', {}), null);
});

const ANY = /^Use: node scripts\//;
const denyAny = (command, expected) => assertDenied(command, expected, ANY);

test('denies bypass variants of test, typecheck and build', () => {
  for (const command of [
    'npx vitest run', 'npx -y jest', 'pnpm exec jest', 'pnpm --filter @labshelf/core exec tsc --noEmit', 'pnpm jest', 'node node_modules/.bin/jest',
    './node_modules/.bin/tsc -p .', 'node node_modules/typescript/bin/tsc', 'yarn test', 'yarn run typecheck', 'npm run build', 'npm test', 'npm t',
    'bash -c "pnpm test"', "sh -c 'cd packages/core && npx jest'", 'bash -lc "tsc"', 'env FOO=1 jest', 'env -i FOO=1 pnpm test', 'timeout 60 pnpm test',
    'timeout -k 5 60 npx tsc', 'nohup node --test x.mjs', 'eval "pnpm build"', 'cd x && FOO=1 timeout 9 yarn typecheck | tail -3',
  ]) assertDenied(command);
  assertDenied('pnpm --filter @labshelf/core exec jest foo', 'node scripts/agents/run.mjs test core -- foo');
  assertDenied('yarn workspace @labshelf/browser build', 'node scripts/agents/run.mjs build browser');
});

test('allows look-alikes of the test runner bypass', () => {
  for (const command of [
    'pnpm install', 'pnpm add -D jest', 'npm install jest', 'npx prettier --check .', 'yarn install', 'npm run build:chrome', 'echo "pnpm test"', 'grep -rn jest packages',
    'bash -c "node scripts/agents/run.mjs test core"', 'bash script.sh', "bash -c 'echo hi'", 'env FOO=1 node x.mjs', 'timeout 5 sleep 1', 'cat jest.config.js', 'node scripts/docs/doc.mjs code',
  ]) assert.equal(run(command), null, command);
});

test('denies sed and perl that rewrite import paths in package code', () => {
  for (const command of [
    `sed -i "s#from '../old'#from '../new'#" packages/core/src/a.ts`,
    `sed -i '' -e "s/\\.js'/.ts'/" packages/core/src/a.ts`,
    `sed -i.bak 's/import("a")/import("b")/g' packages/core/src/a.tsx`,
    `perl -pi -e 's/from "..\\/old"/from "..\\/new"/g' packages/browser/src/x.ts`,
    `cd packages/core && sed -i 's/from "x"/from "y"/' src/a.ts`,
    `grep -rl old packages | xargs sed -i 's/from "old"/from "new"/'`,
    `find packages -name '*.ts' -exec sed -i "s/from 'a'/from 'b'/" {} \\;`,
    `bash -c "sed -i 's/from \\"a\\"/from \\"b\\"/' packages/core/src/a.ts"`,
  ]) denyAny(command, 'moveFiles.mjs');
});

test('denies identifier renames over several package files and names renameSymbol', () => {
  denyAny(`sed -i 's/\\bfooBar\\b/bazQux/g' packages/core/src/*.ts`, 'renameSymbol.mjs <file-that-exports-it> fooBar bazQux');
  denyAny(`git ls-files packages | xargs sed -i 's/fooBar/bazQux/g'`, 'fooBar bazQux');
  denyAny(`find packages/core -name '*.ts' | xargs perl -pi -e 's/\\bfooBar\\b/bazQux/g'`, 'renameSymbol.mjs');
  denyAny(`sed -i 's/fooBar/bazQux/' packages/core/src/a.ts packages/core/src/b.ts`, 'renameSymbol.mjs');
});

test('allows single-file and non-code sed edits', () => {
  for (const command of [
    `sed -i 's/fooBar/bazQux/g' packages/core/src/a.ts`,
    `sed -i 's/timeout = 5/timeout = 10/' packages/core/src/a.ts`,
    `sed -i 's/fooBar/bazQux/g' documents/*.md`,
    `sed -i 's/from "a"/from "b"/' scripts/x.mjs`,
    `grep -rl foo docs | xargs sed -i 's/foo/bar/'`,
    `sed -n '1,5p' packages/core/src/a.ts`,
    `sed -i 's/a/b/' $(git ls-files)`,
    `perl -pi -e 's/\\t/  /' packages/core/src/a.ts`,
  ]) assert.equal(run(command), null, command);
});

test('denies git mv of code files and package folders', () => {
  for (const command of [
    'git mv packages/core/src/a.ts packages/core/src/b.ts', 'git mv a.tsx b.tsx', 'git mv -f scripts/x.mjs scripts/y.mjs', 'git -C . mv packages/core/src/old packages/core/src/new',
    'cd packages/core && git mv src/old src/new', 'git add . && git mv packages/a/b.ts packages/a/c.ts | cat',
  ]) denyAny(command, 'moveFiles.mjs moves.tsv');
  denyAny('git mv a.ts b.ts', '--dry-run');
  for (const command of ['git mv README.md docs.md', 'git mv documents/a.md documents/b.md', 'git mv packages/core/logo.png packages/core/mark.png', 'git status', 'git add packages/core/a.ts']) assert.equal(run(command), null, command);
});

test('denies Bash reads of documents except plans and ideas', () => {
  for (const command of [
    'cat documents/code.md', 'head -50 documents/contracts/helper.md', 'tail -n 20 ./documents/ui.md', "sed -n '1,40p' documents/product.md", "awk 'NR<9' documents/code.md", 'bat documents/ui.md', 'nl documents/code.md | head',
    'less documents/code.md', 'cd documents && cat code.md', 'cd /repo/documents/contracts && head helper.md', 'cat /repo/documents/code.md', 'echo x; cat documents/*.md',
    `python3 -c "print(open('documents/code.md').read())"`, `node -e "console.log(require('fs').readFileSync('documents/ui.md','utf8'))"`,
  ]) denyAny(command, 'scripts/docs/doc.mjs');
  denyAny('cat documents/contracts/helper.md', 'doc.mjs contracts/helper#<anchor>');
});

test('allows reads of plans, ideas, other files and grep on documents', () => {
  for (const command of [
    'cat documents/plans/x/plan.yaml', 'cat documents/ideas/a.md', 'cd documents/plans && cat log.md', 'grep -n "## Files" documents/code.md', 'rg -n heading documents',
    'cat package.json', 'cat packages/documents/a.md', "sed -i 's/a/b/' documents/code.md", 'node scripts/docs/doc.mjs code#files', 'cat > documents/code.md', 'echo hi | cat', 'wc -l documents/code.md',
  ]) assert.equal(run(command), null, command);
});

test('denies a grep for one identifier once per session', () => {
  const session = newSession();
  const ask = (command) => run(command, { session_id: session, tool_name: 'Bash', tool_input: { command } });
  const first = ask('rg -n formatError packages');
  assert.equal(first.permissionDecision, 'deny');
  assert.match(first.permissionDecisionReason, /facts\.mjs def formatError .*callers formatError/);
  assert.equal(ask('rg -n formatError packages'), null);
  assert.equal(ask('grep -rn "\\bparse_item\\b" packages/core/src').permissionDecision, 'deny');
  assert.equal(ask('git grep -w buildIndex').permissionDecision, 'deny');
  assert.equal(ask('cd packages/core && grep -rn makeThing').permissionDecision, 'deny');
  assert.equal(ask('rg -e openLibrary -g "*.ts" packages').permissionDecision, 'deny');
});

test('a facts lookup of the identifier lets the grep through', () => {
  const session = newSession();
  const ask = (command) => run(command, { session_id: session, tool_name: 'Bash', tool_input: { command } });
  assert.equal(ask('node scripts/code/facts.mjs def formatError'), null);
  assert.equal(ask('rg formatError packages'), null);
  assert.equal(ask('pnpm facts callers Foo.openLibrary && rg openLibrary packages'), null);
  assert.equal(ask('rg closeLibrary packages').permissionDecision, 'deny');
});

test('never denies greps for env vars, phrases, regexes, other paths, files or stdin', () => {
  for (const command of [
    'rg NODE_ENV packages', 'rg -n "form at" packages', 'rg "foo.*bar" packages', 'rg formatError scripts', 'rg formatError documents', 'grep -rn formatError .claude', 'rg formatError packages/core/src/a.ts',
    'cat x | grep formatError', 'grep -n formatError packages/core/src/a.ts', 'rg todo packages', 'rg abc packages', 'rg "formatError(" packages', 'rg -e foo_bar -e baz_qux packages', 'cd .. && rg formatError',
    'grep -n formatError', 'rg formatError ../other', 'rg formatError /elsewhere/packages', 'rg formatError $HOME/packages',
  ]) assert.equal(run(command), null, command);
});

test('denies only identifiers with an inner case change or underscore, at least 6 characters', () => {
  for (const id of ['sha256Hex', 'PaperRecord', 'resolve_root']) assert.equal(run(`rg ${id} packages`).permissionDecision, 'deny', id);
  for (const word of ['Error', 'Node', 'Library', 'Paper', 'fooBa', 'parse', 'format_']) assert.equal(run(`rg ${word} packages`), null, word);
});

test('does not parse heredoc bodies as commands', () => {
  const body = 'import sys\n# git mv a.ts b.ts\n# sed -i "s/from x/from y/" packages/core/src/a.ts\n# pnpm test\n# cat documents/code.md';
  assert.equal(run(`python3 - <<'EOF'\n${body}\nEOF`), null);
  assert.equal(run(`cat <<EOF > f\n${body}\nEOF`), null);
  assert.equal(run(`cat <<-"END" > f\n\t${body}\n\tEND`), null);
  denyAny(`cat <<EOF > f\nbody\nEOF\ngit mv a.ts b.ts`, 'moveFiles.mjs');
  denyAny(`pnpm test <<EOF\nx\nEOF`, 'run.mjs');
});
