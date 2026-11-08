// Bundles the relay Worker and the share Worker into one ES module script each; run directly, it writes
// dist/relay-worker.mjs and dist/share-worker.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "../..");

// The Workers reach the spell checker through the core barrels but never start it; its hunspell-asm (CommonJS, with
// emscripten's Node runtime) does not resolve on the neutral platform, so it bundles as an empty module.
const noSpellChecker = {
  name: "no-spell-checker",
  setup(builder) {
    builder.onResolve({ filter: /^hunspell-asm(\/|$)/ }, (args) => ({ path: args.path, namespace: "no-spell-checker" }));
    builder.onLoad({ filter: /.*/, namespace: "no-spell-checker" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

/** The Worker script as uploaded to Cloudflare; throws when anything in it would need Node. */
async function bundleWorker(entry, label) {
  const result = await build({
    entryPoints: [join(coreDir, entry)],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "silent",
    plugins: [noSpellChecker],
  });
  const script = result.outputFiles[0].text;
  // INVARIANT: the Workers run without nodejs_compat, so a node: import would fail at upload.
  if (/\bfrom\s*["']node:|import\(\s*["']node:/.test(script)) { throw new Error(`${label} Worker bundle imports a node: module`); }
  return script;
}

/** Defines `RELAY_WORKER_SCRIPT` in the app bundles. */
export const bundleRelayWorker = () => bundleWorker("src/relay/worker/index.ts", "relay");

/** Defines `SHARE_WORKER_SCRIPT` in the app bundles. */
export const bundleShareWorker = () => bundleWorker("src/relay/worker/shareWorker.ts", "share");

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const [name, bundle] of [["relay-worker.mjs", bundleRelayWorker], ["share-worker.mjs", bundleShareWorker]]) {
    const output = join(coreDir, "dist", name);
    const script = await bundle();
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, script);
    console.log(`worker: ${output} (${script.length} bytes)`);
  }
}
