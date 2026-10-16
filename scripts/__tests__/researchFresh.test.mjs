// Pins which research entries are reported stale after their files change since their sha.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), '..', 'research-fresh.mjs');

const git = (repo, ...args) =>
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();

const write = (repo, rel, text) => {
  mkdirSync(dirname(join(repo, rel)), { recursive: true });
  writeFileSync(join(repo, rel), text);
};

const entry = (header, body = '\n# Notes\n\nBody.\n') => `${header.join('\n')}\n${body}`;

function buildRepo() {
  const repo = mkdtempSync(join(tmpdir(), 'research-fresh-'));
  git(repo, 'init', '-q');
  write(repo, 'packages/a.ts', 'a1\n');
  write(repo, 'packages/b.ts', 'b1\n');
  write(repo, 'packages/core/src/x.ts', 'x1\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'base');
  const sha = git(repo, 'rev-parse', 'HEAD');
  const r = 'documents/plans/p/research';
  write(repo, `${r}/README.md`, 'files: packages/a.ts\nsha: ' + sha + '\n');
  write(repo, `${r}/changed.md`, entry([`sha: ${sha}`, 'files: packages/a.ts']));
  write(repo, `${r}/unchanged.md`, entry([`sha: ${sha}`, 'files: packages/b.ts']));
  write(repo, `${r}/glob.md`, entry([`sha: ${sha}`, 'source: scout', 'files: packages/core/src/**']));
  write(repo, `${r}/nofiles.md`, entry([`sha: ${sha}`, 'source: scout']));
  write(repo, `${r}/unknown.md`, entry(['sha: 0000000000000000000000000000000000000001', 'files: packages/b.ts']));
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'research');
  return { repo, sha };
}

const run = (repo) => execFileSync(process.execPath, [script, '--root', repo], { encoding: 'utf8' }).trimEnd().split('\n');

test('lists exactly the entries whose files changed since their sha, sorted by path', () => {
  const { repo } = buildRepo();
  write(repo, 'packages/a.ts', 'a2\n');
  git(repo, 'commit', '-q', '-am', 'change a');
  write(repo, 'packages/core/src/x.ts', 'x2\n');
  const base = 'documents/plans/p/research';
  assert.deepEqual(run(repo), [
    `stale ${base}/changed.md — changed: packages/a.ts`,
    `stale ${base}/glob.md — changed: packages/core/src/x.ts`,
    `fresh ${base}/nofiles.md`,
    `fresh ${base}/unchanged.md`,
    `stale ${base}/unknown.md — unknown sha 0000000000000000000000000000000000000001`,
  ]);
});

test('everything with files is fresh when nothing changed, and README.md is skipped', () => {
  const { repo } = buildRepo();
  const lines = run(repo);
  assert.ok(!lines.some((l) => l.includes('README.md')));
  assert.ok(lines.includes('fresh documents/plans/p/research/changed.md'));
  assert.ok(lines.includes('fresh documents/plans/p/research/glob.md'));
});

test('uncommitted changes make an entry stale', () => {
  const { repo } = buildRepo();
  write(repo, 'packages/b.ts', 'b2\n');
  assert.ok(run(repo).includes('stale documents/plans/p/research/unchanged.md — changed: packages/b.ts'));
});

test('exits 0 when stale entries exist', () => {
  const { repo } = buildRepo();
  write(repo, 'packages/a.ts', 'a2\n');
  assert.doesNotThrow(() => run(repo));
});
