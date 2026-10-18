// Bundles the relay Worker into one ES module script; run directly, it writes dist/relay-worker.mjs.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const coreDir = join(dirname(fileURLToPath(import.meta.url)), "../..");
const entry = join(coreDir, "src/relay/worker/index.ts");
const output = join(coreDir, "dist/relay-worker.mjs");

/** The Worker script as uploaded to Cloudflare; throws when anything in it would need Node. */
export async function bundleRelayWorker() {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    minify: true,
    write: false,
    logLevel: "silent",
  });
  const script = result.outputFiles[0].text;
  // INVARIANT: the Worker runs without nodejs_compat, so a node: import would fail at upload.
  if (/\bfrom\s*["']node:|import\(\s*["']node:/.test(script)) { throw new Error("relay Worker bundle imports a node: module"); }
  return script;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const script = await bundleRelayWorker();
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, script);
  console.log(`relay worker: ${output} (${script.length} bytes)`);
}
