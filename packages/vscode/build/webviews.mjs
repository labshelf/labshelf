// Bundles browser runtimes for VS Code webviews.
import { build, context } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");
const distDir = resolve(pkgRoot, "dist");
const BUNDLES = {
  "reader/reader": "src/reader/main.ts",
  "library/library": "src/libraryWebview/main.ts",
  "library/sidebar": "src/sidebarWebview/main.ts",
  "library/details": "src/detailsWebview/main.ts",
  "templates/templates": "src/writing/templates/webview/main.ts",
  "search/search": "src/writing/search/webview/main.ts",
  "history/history": "src/writing/history/webview/main.ts",
  "spaces/chat": "src/spaces/chat/webview/main.ts",
  "spaces/spaces": "src/spaces/webview/main.ts",
  "projects/projects": "src/writing/allProjects/webview/main.ts",
  "syncGuide/syncGuide": "src/library/syncGuidePanel/webview/main.ts",
};

const watch = process.argv.includes("--watch");
const production = process.argv.includes("--production");

const options = {
  entryPoints: Object.fromEntries(Object.entries(BUNDLES).map(([out, src]) => [out, resolve(pkgRoot, src)])),
  outdir: distDir,
  bundle: true,
  format: "esm",
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
  for (const dir of new Set(Object.keys(BUNDLES).map((out) => out.split("/")[0]))) {
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
