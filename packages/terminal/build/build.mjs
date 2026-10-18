/** Bundles @labshelf/terminal into dist/labshelf.mjs (the `labshelf` command), dist/thumbnailWorker.mjs, dist/labshelf-helper.mjs (LabShelf Helper, which must stay free of the PDF stack) and dist/bridgeHost.js (the browser bridge host, an ES module that the launcher starts with Node). @labshelf/core is bundled from source; pdfjs-dist, Tesseract and the native canvas stay external and are loaded from node_modules at run time, only when a PDF is parsed, read by OCR or rendered. */
import { build, context } from "esbuild";
import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const watch = process.argv.includes("--watch");

const banner = [
  "#!/usr/bin/env node",
  "import { createRequire as __labshelfCreateRequire } from 'node:module';",
  "const require = __labshelfCreateRequire(import.meta.url);",
].join("\n");

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // Loaded lazily from node_modules: pdfjs reads its data files next to itself, the canvas is a native module.
  external: ["pdfjs-dist", "pdfjs-dist/*", "@napi-rs/canvas", "pdf-lib", "tesseract.js"],
  banner: { js: banner },
};

const entries = [
  { ...common, entryPoints: [resolve(root, "src/main.ts")], outfile: resolve(root, "dist/labshelf.mjs") },
  { ...common, entryPoints: [resolve(root, "src/preview/thumbnailWorker.ts")], outfile: resolve(root, "dist/thumbnailWorker.mjs"), banner: { js: banner.split("\n").slice(1).join("\n") } },
  { ...common, entryPoints: [resolve(root, "src/helper/main.ts")], outfile: resolve(root, "dist/labshelf-helper.mjs"), metafile: true, banner: { js: banner.split("\n").slice(1).join("\n") } },
  { ...common, entryPoints: [resolve(root, "../core/src/bridge/node/hostEntry.ts")], outfile: resolve(root, "dist/bridgeHost.js"), banner: { js: banner.split("\n").slice(1).join("\n") } },
];

// The helper starts on every browser launch of a native-messaging host; it never needs the PDF stack.
const HELPER_FORBIDDEN = /(^|[/\\])(pdfjs-dist|@napi-rs[/\\]canvas|pdf-lib|tesseract\.js)([/\\]|$)/;

function assertHelperBundle(result) {
  const output = Object.values(result.metafile.outputs)[0];
  const offenders = [...Object.keys(result.metafile.inputs), ...output.imports.map((entry) => entry.path)].filter((entry) => HELPER_FORBIDDEN.test(entry));
  if (offenders.length > 0) {
    throw new Error(`labshelf-helper must not import the PDF stack, but the bundle reaches: ${[...new Set(offenders)].join(", ")}`);
  }
}

if (watch) {
  for (const options of entries) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log("[labshelf-terminal] watching…");
} else {
  const results = await Promise.all(entries.map((options) => build(options)));
  assertHelperBundle(results[entries.findIndex((options) => options.metafile)]);
  await chmod(resolve(root, "dist/labshelf.mjs"), 0o755);
  console.log("[labshelf-terminal] built dist/labshelf.mjs");
}
