// Writes downloads.json for the template catalog in the current folder; the entry bundled into count-downloads.mjs.
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { countDownloads } from '../../packages/core/src/writing/templates/downloads/index.ts';

function readTemplates(path) {
  const index = JSON.parse(readFileSync(path, 'utf8'));
  const templates = index?.templates;
  if (!Array.isArray(templates) || templates.some((t) => typeof t?.id !== 'string' || typeof t?.main !== 'string')) {
    throw new Error(`${path} has no templates list with an id and a main file for each entry`);
  }
  return templates.map(({ id, main }) => ({ id, main }));
}

try {
  const templates = readTemplates(join(process.cwd(), 'index.json'));
  const counts = await countDownloads(templates, fetch);
  // The rename keeps a crash mid-write from leaving a partial downloads.json.
  const target = join(process.cwd(), 'downloads.json');
  writeFileSync(`${target}.tmp`, `${JSON.stringify(counts, null, 2)}\n`);
  renameSync(`${target}.tmp`, target);
} catch (error) {
  console.error(`count-downloads failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
