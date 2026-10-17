/** Bundles @labshelf/terminal into dist/labshelf.mjs (the `labshelf` command) and dist/thumbnailWorker.mjs. @labshelf/core is bundled from source; pdfjs-dist, Tesseract and the native canvas stay external and are loaded from node_modules at run time, only when a PDF is parsed, read by OCR or rendered. */
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
];

if (watch) {
  for (const options of entries) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log("[labshelf-terminal] watching…");
} else {
  await Promise.all(entries.map((options) => build(options)));
  await chmod(resolve(root, "dist/labshelf.mjs"), 0o755);
  console.log("[labshelf-terminal] built dist/labshelf.mjs");
}
