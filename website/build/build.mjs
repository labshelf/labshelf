/** Bundles the website demo entries and the pdf.js assets the reader demo loads into website/dist/. */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(pkgRoot, "dist");

// pdf.sandbox.mjs is the only user of the QuickJS engine; the reader never loads it.
const SKIP_WASM = new Set(["quickjs-eval.js", "quickjs-eval.wasm"]);

async function copyPdfjs() {
  const require = createRequire(join(pkgRoot, "package.json"));
  const root = join(dirname(require.resolve("pdfjs-dist/package.json")));
  const dest = join(outDir, "pdfjs");
  const copy = (from, to, skip = new Set()) =>
    cp(join(root, from), join(dest, to), { recursive: true, filter: (p) => !skip.has(basename(p)) });
  await mkdir(dest, { recursive: true });
  await copy("legacy/build/pdf.min.mjs", "build/pdf.min.mjs");
  await copy("legacy/build/pdf.worker.min.mjs", "build/pdf.worker.min.mjs");
  await copy("legacy/web/pdf_viewer.mjs", "web/pdf_viewer.mjs");
  await copy("legacy/web/pdf_viewer.css", "web/pdf_viewer.css");
  await copy("legacy/web/images", "web/images");
  for (const dir of ["cmaps", "standard_fonts", "iccs"]) await copy(dir, dir);
  await copy("wasm", "wasm", SKIP_WASM);
}

await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: { "demos/library": join(pkgRoot, "src/demos/library.ts"), "demos/reader": join(pkgRoot, "src/demos/reader.ts") },
  outdir: outDir,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  // A stylesheet or icon imported from TS is its text, as in the extension builds.
  loader: { ".css": "text", ".svg": "text" },
  logLevel: "info",
});
await copyPdfjs();
