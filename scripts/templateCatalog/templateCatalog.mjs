// Emits the standalone validate.mjs, build-index.mjs and count-downloads.mjs for the template catalog repository, bundled from core.
import { build } from 'esbuild';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = process.argv[2];
if (outDir === undefined) {
  console.error('usage: templateCatalog.mjs <outDir>');
  process.exit(1);
}

const entries = dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: {
    validate: join(entries, 'validateCli.mjs'),
    'build-index': join(entries, 'buildIndexCli.mjs'),
    'count-downloads': join(entries, 'countDownloadsCli.mjs'),
  },
  outdir: outDir,
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // PLATFORM: the yaml package bundles as CommonJS, and an ES module has no `require` for its built-in imports.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'warning',
});
