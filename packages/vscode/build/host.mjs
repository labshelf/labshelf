/** Bundles the desktop extension host into out/extension.js, the browser bridge host into out/bridgeHost.js and the LaTeX helper host into out/helperHost.js. @labshelf/* packages are bundled from source; every other dependency stays external and loads from node_modules, because pdf.js, Tesseract and the native canvas locate their own data files, workers and binaries next to themselves. */
import { build, context } from "esbuild";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleRelayWorker } from "../../core/tools/relayWorker/bundleRelayWorker.mjs";
import { writeArcMarks } from "./arcMarks.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outDir = resolve(pkgRoot, "out");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const manifest = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
const externalDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith("@labshelf/"));

const baseOptions = {
  entryPoints: [resolve(pkgRoot, "src/extension.ts")],
  outfile: resolve(outDir, "extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  // Matches the Node of the Electron shipped with engines.vscode ^1.106.
  target: ["node20"],
  // `vscode` is provided by the host; `node:sqlite` is a builtin esbuild leaves alone.
  // TRAP: typst.ts dynamically imports its optional renderer peer, which is not installed; the host only compiles, so that import never runs.
  external: ["vscode", "@myriaddreamin/typst-ts-renderer", ...externalDependencies],
  minify: production,
  sourcemap: true,
  tsconfig: resolve(pkgRoot, "tsconfig.json"),
  logLevel: "info",
};

// Only the extension bundle deploys the relay, so only it carries the Worker script; watch mode keeps the script of its start.
const options = { ...baseOptions, define: { RELAY_WORKER_SCRIPT: JSON.stringify(await bundleRelayWorker()) } };

// The browser starts this file through Native Messaging; it loads nothing from node_modules.
const bridgeHostOptions = {
  ...baseOptions,
  entryPoints: [resolve(pkgRoot, "../core/src/bridge/node/hostEntry.ts")],
  outfile: resolve(outDir, "bridgeHost.js"),
  external: [],
};

// The LaTeX helper host: started by the browser like the bridge, bundles core's helper only.
const helperHostOptions = {
  ...options,
  entryPoints: [resolve(pkgRoot, "src/node/helperHost.ts")],
  outfile: resolve(outDir, "helperHost.js"),
  external: ["@myriaddreamin/typst-ts-renderer"],
};

// The helper host loads nothing from node_modules, so its Typst compiler WASM sits beside it under the name `runHelperScriptHost` reads.
async function copyTypstWasm() {
  await mkdir(outDir, { recursive: true });
  await copyFile(createRequire(import.meta.url).resolve("@myriaddreamin/typst-ts-web-compiler/wasm"), resolve(outDir, "typst_ts_web_compiler_bg.wasm"));
}

// NodeCellRunner runs the drivers (Python, Wolfram, R) from beside extension.js.
async function copyCellDriver() {
  await mkdir(outDir, { recursive: true });
  const require = createRequire(import.meta.url);
  for (const file of ["cellDriver.py", "cellDriver.wl", "cellDriver.R"]) {
    await copyFile(require.resolve(`@labshelf/core/qmd/compute/node/${file}`), resolve(outDir, file));
  }
}

if (watch) {
  await writeArcMarks(outDir);
  await copyTypstWasm();
  await copyCellDriver();
  for (const entry of [options, bridgeHostOptions, helperHostOptions]) {
    const ctx = await context(entry);
    await ctx.watch();
  }
  console.log(`[labshelf-host] watching → ${options.outfile}`);
} else {
  await rm(outDir, { recursive: true, force: true });
  await Promise.all([build(options), build(bridgeHostOptions), build(helperHostOptions)]);
  await writeArcMarks(outDir);
  await copyTypstWasm();
  await copyCellDriver();
}
