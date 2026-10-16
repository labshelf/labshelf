// Reports which plan research entries are stale because their files changed since the entry's sha.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag > 0 ? process.argv[rootFlag + 1] : process.cwd();

const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function entryPaths() {
  const plans = join(root, 'documents', 'plans');
  if (!existsSync(plans)) return [];
  return readdirSync(plans, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .flatMap((d) => {
      const dir = join('documents', 'plans', d.name, 'research');
      if (!existsSync(join(root, dir))) return [];
      return readdirSync(join(root, dir))
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => `${dir}/${f}`);
    })
    .sort();
}

// Header lines sit before the first heading; later `sha:` text in the body must not count.
function parseHeader(text) {
  const header = {};
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) break;
    const m = /^(sha|files):\s*(.*)$/.exec(line);
    if (m) header[m[1]] = m[2].trim();
  }
  return header;
}

function status(rel) {
  const { sha, files } = parseHeader(readFileSync(join(root, rel), 'utf8'));
  if (!files) return `fresh ${rel}`;
  if (!sha) return `stale ${rel} — missing sha`;
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
  } catch {
    return `stale ${rel} — unknown sha ${sha}`;
  }
  const specs = files.split(',').map((f) => f.trim()).filter(Boolean).map((f) => `:(glob)${f}`);
  const changed = git('diff', '--name-only', '--relative', sha, '--', ...specs).split('\n').filter(Boolean);
  return changed.length ? `stale ${rel} — changed: ${changed.join(', ')}` : `fresh ${rel}`;
}

for (const rel of entryPaths()) console.log(status(rel));
