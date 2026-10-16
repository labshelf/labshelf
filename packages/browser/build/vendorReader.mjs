/**
 * Copies what the reader page loads at runtime into the per-target dist folder:
 * - pdf.js (legacy build, the one the VS Code reader uses) into vendor/pdfjs/{build,web,cmaps,standard_fonts,wasm,iccs};
 * - the shared reader stylesheet from @labshelf/core into reader/reader.css;
 * - the design tokens, base, toast, settings and library UI styles from @labshelf/core into ui/styles/, where the pages link them.
 * pdf_viewer.mjs goes through esbuild (es2023): its `v`-flag regex makes the addons-linter behind `web-ext lint` fail.
 */
import { transform } from "esbuild";
import { copyFile, cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, dirname, join } from "node:path";

// pdf.sandbox.mjs is the only user of the QuickJS engine; the reader never loads it.
const SKIP_WASM = new Set(["quickjs-eval.js", "quickjs-eval.wasm"]);

const copyDir = (src, dst, skip = new Set()) =>
  cp(src, dst, { recursive: true, filter: (path) => !skip.has(basename(path)) });

export async function vendorReader({ outDir, pkgRoot }) {
  const require = createRequire(join(pkgRoot, "package.json"));
  const pdfjsRoot = dirname(require.resolve("pdfjs-dist/package.json"));
  const vendor = join(outDir, "vendor", "pdfjs");

  await mkdir(join(vendor, "build"), { recursive: true });
  await mkdir(join(vendor, "web"), { recursive: true });
  await copyFile(join(pdfjsRoot, "legacy/build/pdf.min.mjs"), join(vendor, "build/pdf.min.mjs"));
  await copyFile(join(pdfjsRoot, "legacy/build/pdf.worker.min.mjs"), join(vendor, "build/pdf.worker.min.mjs"));
  const viewer = await readFile(join(pdfjsRoot, "legacy/web/pdf_viewer.mjs"), "utf8");
  const lowered = await transform(viewer, { loader: "js", format: "esm", target: "es2023" });
  await writeFile(join(vendor, "web/pdf_viewer.mjs"), lowered.code);
  await copyFile(join(pdfjsRoot, "legacy/web/pdf_viewer.css"), join(vendor, "web/pdf_viewer.css"));
  await copyDir(join(pdfjsRoot, "legacy/web/images"), join(vendor, "web/images"));
  for (const dir of ["cmaps", "standard_fonts", "iccs"]) {
    await copyDir(join(pdfjsRoot, dir), join(vendor, dir));
  }
  await copyDir(join(pdfjsRoot, "wasm"), join(vendor, "wasm"), SKIP_WASM);

  await mkdir(join(outDir, "reader"), { recursive: true });
  await copyFile(require.resolve("@labshelf/core/styles/reader.css"), join(outDir, "reader/reader.css"));
  await mkdir(join(outDir, "ui/styles"), { recursive: true });
  for (const sheet of ["tokens", "base", "toast", "settings", "library-ui", "library-list", "library-detail", "library-tabs", "library-citation-map"]) {
    await copyFile(require.resolve(`@labshelf/core/styles/${sheet}.css`), join(outDir, `ui/styles/${sheet}.css`));
  }
}
