// Validates the template catalog in the current folder; the entry bundled into validate.mjs.
import { checkCatalog } from '../../packages/core/src/templates/node/index.ts';

const problems = await checkCatalog(process.cwd());
if (problems.length === 0) {
  console.log('Catalog OK');
} else {
  for (const { id, reason } of problems) console.error(`${id}: ${reason}`);
  process.exitCode = 1;
}
