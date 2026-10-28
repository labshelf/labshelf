#!/usr/bin/env node
// PostToolUse hook on Edit|Write|MultiEdit: after an edit under packages/*/src or packages/*/__tests__ it marks the code-facts index dirty
// and starts a background `facts build` unless one already runs (that build repeats itself when it finds the marker).
// Acts only when the database exists; any other path, any error: no output, exit 0.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { lockHeld } from '../../scripts/code/lib.mjs';

const FACTS = new URL('../../scripts/code/facts.mjs', import.meta.url).pathname;
const TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const SOURCE = /^packages\/[^/]+\/(src|__tests__)\/.+\.tsx?$/;

function main(input) {
  if (!TOOLS.has(input.tool_name)) return;
  const target = input.tool_input?.file_path;
  if (typeof target !== 'string' || !target) return;
  const cwd = input.cwd ?? process.cwd();
  const root = resolve(process.env.CLAUDE_PROJECT_DIR ?? cwd);
  const rel = relative(root, resolve(cwd, target));
  if (rel.startsWith('..') || isAbsolute(rel) || !SOURCE.test(rel.split('\\').join('/'))) return;
  const dir = join(root, '.code-facts');
  if (!existsSync(process.env.LABSHELF_FACTS_DB ?? join(dir, 'facts.db'))) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'dirty'), '');
  if (lockHeld(join(dir, 'build.lock'))) return;
  spawn(process.execPath, [FACTS, 'build', '--quiet'], { cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, LABSHELF_FACTS_ROOT: root } }).unref();
}

try {
  main(JSON.parse(readFileSync(0, 'utf8')));
} catch {
  // A hook never breaks a session.
}
