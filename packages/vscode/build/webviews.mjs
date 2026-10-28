// Bundles browser runtimes for VS Code webviews.
import { build, context } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = resolve(pkgRoot, "dist");
const BUNDLES = {
  "reader/reader": "src/reader/webview/readerEntry.ts",
  "library/library": "src/libraryUi/webview/libraryEntry.ts",
  "library/sidebar": "src/libraryUi/webview/sidebarEntry.ts",
  "library/details": "src/libraryUi/webview/detailsEntry.ts",
  "templates/templates": "src/writing/templates/webview/galleryEntry.ts",
  "search/search": "src/writing/search/webview/searchEntry.ts",
  "history/history": "src/writing/history/webview/historyEntry.ts",
  "spaces/chat": "src/spaces/webview/researchChatEntry.ts",
  "spaces/spaces": "src/spaces/webview/spacesEntry.ts",
  "projects/projects": "src/writing/webview/allProjectsEntry.ts",
  "syncGuide/syncGuide": "src/library/webview/syncGuideEntry.ts",
};

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const options = {
  entryPoints: Object.fromEntries(Object.entries(BUNDLES).map(([out, src]) => [out, resolve(pkgRoot, src)])),
  outdir: distDir,
  bundle: true,
  format: "esm",
  // Dynamic imports (the editor's `@labshelf/core/math`) become separate chunks under dist/chunks, loaded on first use.
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  platform: "browser",
  // Matches the Chromium shipped with the Electron of engines.vscode ^1.106 (Electron 37, Chromium 138).
  target: ["chrome138"],
  // pdf.js is loaded at runtime by dynamic import() of webview URIs; only its
  // types are imported. A value import must fail loudly instead of silently
  // pulling ~1 MB into the bundle.
  external: ["pdfjs-dist", "pdfjs-dist/*"],
  minify: production,
  // External maps do not resolve through the webview resource scheme.
  sourcemap: production ? false : "inline",
  tsconfig: resolve(pkgRoot, "tsconfig.webview.json"),
  logLevel: "info",
};

async function main() {
  const dirs = new Set(Object.keys(BUNDLES).map((out) => out.split("/")[0]));
  dirs.add("chunks");
  for (const dir of dirs) {
    await rm(resolve(distDir, dir), { recursive: true, force: true });
    await mkdir(resolve(distDir, dir), { recursive: true });
  }
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    // eslint-disable-next-line no-console
    console.log(`[labshelf-webviews] watching → ${distDir}`);
    return;
  }
  await build(options);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
