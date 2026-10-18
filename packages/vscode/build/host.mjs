/** Bundles the desktop extension host into out/extension.js, the web extension host into out/web/extension.js and the browser bridge host into out/bridgeHost.js. @labshelf/* packages are bundled from source; every other dependency stays external and loads from node_modules, because pdf.js, Tesseract and the native canvas locate their own data files, workers and binaries next to themselves. */
import { build, context } from "esbuild";
import { readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeArcMarks } from "./arcMarks.mjs";
import { noNodePlugin } from "./noNodePlugin.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const outDir = resolve(pkgRoot, "out");

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const manifest = JSON.parse(await readFile(resolve(pkgRoot, "package.json"), "utf8"));
const externalDependencies = Object.keys(manifest.dependencies ?? {}).filter((name) => !name.startsWith("@labshelf/"));

const options = {
  entryPoints: [resolve(pkgRoot, "src/extension.ts")],
  outfile: resolve(outDir, "extension.js"),
  bundle: true,
  platform: "node",
  format: "cjs",
  // Matches the Node of the Electron shipped with engines.vscode ^1.98.
  target: ["node20"],
  // `vscode` is provided by the host; `node:sqlite` is a builtin esbuild leaves alone.
  // TRAP: typst.ts dynamically imports its optional renderer peer, which is not installed; the host only compiles, so that import never runs.
  external: ["vscode", "@myriaddreamin/typst-ts-renderer", ...externalDependencies],
  minify: production,
  sourcemap: true,
  tsconfig: resolve(pkgRoot, "tsconfig.json"),
  logLevel: "info",
};

// The browser starts this file through Native Messaging; it loads nothing from node_modules.
const bridgeHostOptions = {
  ...options,
  entryPoints: [resolve(pkgRoot, "../core/src/bridge/node/hostEntry.ts")],
  outfile: resolve(outDir, "bridgeHost.js"),
  external: [],
};

// The web extension host runs in a browser worker with no node_modules, so everything is bundled and Node is refused.
const webOptions = {
  ...options,
  entryPoints: [resolve(pkgRoot, "src/extensionWeb.ts")],
  outfile: resolve(outDir, "web/extension.js"),
  platform: "browser",
  target: ["es2022"],
  external: ["vscode", "@myriaddreamin/typst-ts-renderer"],
  plugins: [noNodePlugin],
};

if (watch) {
  await writeArcMarks(outDir);
  for (const entry of [options, webOptions, bridgeHostOptions]) {
    const ctx = await context(entry);
    await ctx.watch();
  }
  console.log(`[labshelf-host] watching → ${options.outfile}`);
} else {
  await rm(outDir, { recursive: true, force: true });
  await Promise.all([build(options), build(webOptions), build(bridgeHostOptions)]);
  await writeArcMarks(outDir);
}
