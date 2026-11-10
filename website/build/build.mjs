/** Bundles the website demo entries, the share page and the pdf.js assets the reader demo loads into website/dist/. */
import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeDemoData } from "./demoData.mjs";

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

// TRAP: a text import keeps a sheet's @import rules, which the page cannot follow, so each sheet is bundled with its imports first.
const cssText = {
  name: "css-text",
  setup(b) {
    b.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const out = await build({ entryPoints: [path], bundle: true, write: false, logLevel: "silent" });
      return { contents: out.outputFiles[0].text, loader: "text" };
    });
  },
};

await rm(outDir, { recursive: true, force: true });
await build({
  entryPoints: { "demos/library": join(pkgRoot, "src/demos/library.ts"), "demos/reader": join(pkgRoot, "src/demos/reader.ts"), share: join(pkgRoot, "src/share.ts"), open: join(pkgRoot, "src/open.ts") },
  outdir: outDir,
  bundle: true,
  format: "esm",
  target: "es2022",
  platform: "browser",
  sourcemap: true,
  // The deck view loads as a chunk, only when a deck link is opened.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  // A stylesheet or icon imported from TS is its text, as in the extension builds.
  loader: { ".svg": "text" },
  // typst.ts imports its renderer lazily; /open/ only compiles, so the renderer is never loaded.
  external: ["@myriaddreamin/typst-ts-renderer"],
  plugins: [cssText],
  logLevel: "info",
});
await copyPdfjs();
await writeDemoData(pkgRoot, outDir);
await cp(join(pkgRoot, "demo-library/papers/Language models/Reasoning/wei2022chainofthought/paper.pdf"), join(outDir, "demos/paper.pdf"));
