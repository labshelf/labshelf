// Packages the reader runtime assets and shared page styles for each browser target.
import { build, transform } from "esbuild";
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
  // reader.css @imports the notes sheets and the qmd editor's from outside its folder, so it is bundled into one file.
  await build({ entryPoints: [require.resolve("@labshelf/core/styles/reader.css")], outfile: join(outDir, "reader/reader.css"), bundle: true });
  // preview.css @imports the files of preview/ by relative path, so the folder is copied beside it.
  const previewCss = require.resolve("@labshelf/core/styles/preview.css");
  await copyFile(previewCss, join(outDir, "reader/preview.css"));
  await copyDir(join(dirname(previewCss), "preview"), join(outDir, "reader/preview"));
  await mkdir(join(outDir, "ui/styles"), { recursive: true });
  for (const sheet of ["tokens", "base", "toast", "settings", "library-ui", "library-list", "library-detail", "library-tabs", "library-sidebar", "editor-area", "qmd-editor", "all-projects", "template-gallery", "template-publish", "project-history", "project-search", "source-editor-toolbar"]) {
    await copyFile(require.resolve(`@labshelf/core/styles/${sheet}.css`), join(outDir, `ui/styles/${sheet}.css`));
  }
  for (const sheet of ["page-widgets", "spaces-catalog", "spaces", "research-chat"]) {
    await build({
      entryPoints: [require.resolve(`@labshelf/core/styles/${sheet}.css`)],
      outfile: join(outDir, `ui/styles/${sheet}.css`), bundle: true,
    });
  }
}
