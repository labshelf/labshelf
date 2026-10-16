// Writes index.json for the template catalog in the current folder; the entry bundled into build-index.mjs.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCatalogIndex } from '../../packages/core/src/writing/templates/node/index.ts';

const flag = process.argv.indexOf('--commit');
const commit = flag === -1 ? undefined : process.argv[flag + 1];
if (!/^[0-9a-f]{40}$/.test(commit ?? '')) {
  console.error('usage: build-index.mjs --commit <40-character lowercase hex hash>');
  process.exit(1);
}
try {
  writeFileSync(join(process.cwd(), 'index.json'), await buildCatalogIndex(process.cwd(), commit));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
