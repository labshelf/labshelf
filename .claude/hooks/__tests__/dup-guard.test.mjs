// Pins the dup-guard hook (PostToolUse Edit|Write|MultiEdit): an edit that adds a renamed copy of an indexed function, or a same-named
// near copy, gets one additionalContext line with the original's path:line; unrelated code, other paths, LABSHELF_DUP_GUARD=off, a missing
// database and a repeated edit give no output. Telemetry: dup_check on every check, dup_warning per line.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const hook = new URL('../dup-guard.mjs', import.meta.url).pathname;
const factsCli = new URL('../../../scripts/code/facts.mjs', import.meta.url).pathname;
const TEXT = 'packages/core/src/text.ts';

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
const SAME_NAME = `export function summarizeEntries(entries: readonly Entry[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of entries) {
    const key = entry.title.trim().toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (out.length >= limit) break;
    out.push(entry.id);
    out.push(key);
  }
  return out;
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
let env;
let n = 0;

const put = (path, text) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
};
const events = () =>
  readdirSync(join(root, '.spool'))
    .flatMap((file) => readFileSync(join(root, '.spool', file), 'utf8').split('\n').filter(Boolean))
    .map((line) => JSON.parse(line));
// Runs the hook for a file already on disk; `agent` keys the "already warned" state.
const edit = (path, toolInput = {}, { tool = 'Edit', agent = `agent-${++n}`, extraEnv = {} } = {}) => {
  const started = Date.now();
  const run = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's1', agent_id: agent, cwd: root, tool_name: tool, tool_input: { file_path: join(root, path), ...toolInput } }),
    encoding: 'utf8',
    env: { ...env, ...extraEnv },
  });
  const context = run.stdout ? JSON.parse(run.stdout).hookSpecificOutput.additionalContext : '';
  return { status: run.status, out: run.stdout, err: run.stderr, context, lines: context ? context.split('\n') : [], ms: Date.now() - started };
};

before(() => {
  root = mkdtempSync(join(tmpdir(), 'labshelf-dup-'));
  env = { ...process.env, CLAUDE_PROJECT_DIR: root, LABSHELF_FACTS_ROOT: root, LABSHELF_TELEMETRY_SPOOL: join(root, '.spool'), LABSHELF_HOOK_STATE_DIR: join(root, '.state') };
  delete env.LABSHELF_FACTS_DB;
  delete env.LABSHELF_TELEMETRY;
  delete env.LABSHELF_DUP_GUARD;
  put('packages/core/package.json', JSON.stringify({ name: '@labshelf/core', version: '0.0.0', main: 'src/index.ts', types: 'src/index.ts' }));
  put('packages/core/src/index.ts', 'export { summarizeEntries } from "./text.js";\n');
  put(TEXT, ORIGINAL);
  put('packages/core/src/small.ts', 'export function foo(x: number): number {\n  return x + 1;\n}\n');
  mkdirSync(join(root, 'node_modules', '@labshelf'), { recursive: true });
  symlinkSync(join('..', '..', 'packages', 'core'), join(root, 'node_modules', '@labshelf', 'core'));
  spawnSync('git', ['init', '-q'], { cwd: root });
});

after(() => rmSync(root, { recursive: true, force: true }));

test('a missing database gives no output and no event', () => {
  put('packages/vscode/src/copy.ts', RENAMED);
  const result = edit('packages/vscode/src/copy.ts', {}, { tool: 'Write' });
  assert.deepEqual([result.status, result.out, result.err], [0, '', '']);
  let spooled = [];
  try {
    spooled = events();
  } catch {
    // no spool directory yet
  }
  assert.deepEqual(spooled, []);
  rmSync(join(root, 'packages/vscode/src/copy.ts'));
  const built = spawnSync(process.execPath, [factsCli, 'build', '--quiet'], { env, encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr);
});

test('an Edit adding a renamed copy warns with the original path:line, once per agent', () => {
  const copy = 'packages/vscode/src/copy.ts';
  put(copy, `import { x } from "./x.js";\n\n${RENAMED}`);
  const first = edit(copy, { new_string: RENAMED }, { agent: 'a-copy' });
  assert.equal(first.status, 0);
  assert.equal(first.lines.length, 1, first.context);
  assert.match(first.lines[0], /^possible duplicate: digest \(packages\/vscode\/src\/copy\.ts:3\) ≈ packages\/core\/src\/text\.ts:6 summarizeEntries \(entries: readonly Entry\[\], limit: number\): string\[\] \(T2 1\.00, exported\): reuse or extend it, or say why not in the report$/);
  assert.equal(JSON.parse(first.out).hookSpecificOutput.hookEventName, 'PostToolUse');
  // Same pair, same agent: silent. Another agent is warned again.
  assert.deepEqual([edit(copy, { new_string: RENAMED }, { agent: 'a-copy' }).out], ['']);
  assert.equal(edit(copy, { new_string: RENAMED }, { agent: 'a-other' }).lines.length, 1);
  const check = events().filter((event) => event.kind === 'dup_check').at(-1);
  assert.equal(typeof check.ms, 'number');
  assert.ok(events().some((event) => event.kind === 'dup_warning' && event.reason === 'exact' && event.match.startsWith(`${TEXT}:6`)));
  assert.ok(events().some((event) => event.kind === 'dup_check' && event.warned === 1 && event.units === 1));
  rmSync(join(root, copy));
});

test('a same-named function at 0.6 to 0.8 warns with reason name', () => {
  const copy = 'packages/vscode/src/named.ts';
  put(copy, SAME_NAME);
  const result = edit(copy, { new_string: SAME_NAME });
  assert.equal(result.lines.length, 1, result.context);
  assert.match(result.lines[0], /^possible duplicate: summarizeEntries \(packages\/vscode\/src\/named\.ts:1\) ≈ packages\/core\/src\/text\.ts:6 summarizeEntries .*\(0\.\d\d, exported\)/);
  assert.ok(events().some((event) => event.kind === 'dup_warning' && event.reason === 'name'));
  // The same body under another name is not close enough to warn.
  put(copy, SAME_NAME.replace('summarizeEntries', 'collectTitles'));
  assert.equal(edit(copy, { new_string: 'collectTitles' }).out, '');
  rmSync(join(root, copy));
});

test('Write checks every unit, MultiEdit only the edited ones, and an edit away from the copy is silent', () => {
  const copy = 'packages/vscode/src/many.ts';
  put(copy, `${UNRELATED}\n${RENAMED}`);
  assert.equal(edit(copy, {}, { tool: 'Write' }).lines.length, 1);
  assert.equal(edit(copy, { edits: [{ old_string: 'a', new_string: 'clampAll' }] }, { tool: 'MultiEdit' }).out, '');
  assert.equal(edit(copy, { new_string: 'clamped.sort' }).out, '');
  assert.equal(edit(copy, { edits: [{ old_string: 'a', new_string: 'result.push(`${item.id}: ${label}`);' }, { old_string: 'b', new_string: 'zzz' }] }, { tool: 'MultiEdit' }).lines.length, 1);
  rmSync(join(root, copy));
});

test('an unrelated function, a function under 10 nodes, a scripts path, a .d.ts and the off switch give no output', () => {
  const unrelated = 'packages/vscode/src/clamp.ts';
  put(unrelated, UNRELATED);
  assert.equal(edit(unrelated, { new_string: UNRELATED }).out, '');
  const small = 'packages/vscode/src/small.ts';
  put(small, 'export function foo(x: number): number {\n  return x + 1;\n}\n');
  assert.equal(edit(small, { new_string: 'return x + 1;' }).out, '');
  for (const path of ['scripts/tool.ts', 'packages/vscode/src/types.d.ts', 'packages/vscode/src/data.json', 'packages/vscode/__tests__/copy.ts']) {
    put(path, RENAMED);
    const result = edit(path, { new_string: RENAMED });
    assert.deepEqual([result.status, result.out, result.err], [0, '', ''], path);
  }
  const copy = 'packages/vscode/src/off.ts';
  put(copy, RENAMED);
  assert.equal(edit(copy, { new_string: RENAMED }, { extraEnv: { LABSHELF_DUP_GUARD: 'off' } }).out, '');
  assert.equal(edit(copy, { new_string: RENAMED }).lines.length, 1);
});

test('at most 3 lines, bad input and unrelated tools exit 0 silently, and a warm run takes under 1 s', () => {
  const copy = 'packages/vscode/src/five.ts';
  put(copy, [1, 2, 3, 4, 5].map((i) => RENAMED.replace('digest', `digest${i}`)).join('\n'));
  const result = edit(copy, {}, { tool: 'Write' });
  assert.equal(result.lines.length, 3);
  const warm = edit(copy, {}, { tool: 'Write' });
  assert.ok(warm.ms < 1000, `took ${warm.ms} ms`);
  for (const input of ['', 'not json', '{}', JSON.stringify({ tool_name: 'Read', cwd: root, tool_input: { file_path: join(root, TEXT) } })]) {
    const run = spawnSync(process.execPath, [hook], { input, encoding: 'utf8', env });
    assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', ''], input);
  }
});
