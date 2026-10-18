/**
 * Builds the editor page into editor/: the page bundle, the workbench's workers, the extension-host iframe, the webview host,
 * the two bundled web extensions with Tinymist's LSP worker, and the Typst compiler the page runs for LabShelf.
 */
import { build } from "esbuild";
import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { copyBundledExtensions } from "./bundledExtensions.mjs";
import { cspPatchPlugin, writeExtensionHostIframe } from "./cspPatches.mjs";
import { vscodeAssetsPlugin } from "./vscodeAssets.mjs";
import { writeWebviewHost } from "./webviewHost.mjs";

const common = {
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome125", "firefox128"],
  // The bundles are mostly monaco-vscode-api and Tinymist; maps would add tens of megabytes for little use.
  minify: true,
  sourcemap: false,
  // TRAP: monaco-vscode-api reaches its stylesheets and assets through side-effect imports and import.meta.url.
  plugins: [cspPatchPlugin, vscodeAssetsPlugin],
  // TRAP: @vscode/diff imports node:fs/promises in a branch that runs only under Node; the import stays and never runs.
  // typst.ts dynamically imports its optional renderer peer, which is not installed; the preview only compiles to PDF.
  external: ["node:*", "@myriaddreamin/typst-ts-renderer"],
  assetNames: "assets/[name]-[hash]",
  define: { "process.env.NODE_ENV": JSON.stringify(process.env.NODE_ENV ?? "production") },
  logLevel: "warning",
};

/** Worker label → its entry; outputs land in editor/workers/<label>.js, the names src/editor/workers/index.ts gives the page. */
const WORKERS = {
  editorWorker: "@codingame/monaco-vscode-editor-api/esm/vs/editor/editor.worker.js",
  textMateWorker: "@codingame/monaco-vscode-textmate-service-override/worker",
  extensionHostWorker: "@codingame/monaco-vscode-api/workers/extensionHost.worker",
  extensionHostBootstrap: "./src/editor/workers/extensionHostBootstrap.ts",
};

/** Copies the typst.ts compiler's wasm, which @labshelf/core pins, to editor/typst/ where the preview fetches it. */
async function copyTypstCompiler(pkgRoot, editorDir) {
  const fromCore = createRequire(join(pkgRoot, "../core/package.json"));
  const wasm = join(dirname(fromCore.resolve("@myriaddreamin/typst-ts-web-compiler/package.json")), "pkg/typst_ts_web_compiler_bg.wasm");
  await mkdir(join(editorDir, "typst"), { recursive: true });
  await copyFile(wasm, join(editorDir, "typst/typst_ts_web_compiler_bg.wasm"));
}

export async function buildEditor({ outDir, pkgRoot }) {
  const editorDir = join(outDir, "editor");
  const workersDir = join(editorDir, "workers");
  await mkdir(workersDir, { recursive: true });
  const fromPkg = { absWorkingDir: pkgRoot, nodePaths: [join(pkgRoot, "node_modules")] };
  await Promise.all([
    build({ ...common, ...fromPkg, entryPoints: { main: resolve(pkgRoot, "src/editor/main.ts") }, outdir: editorDir }),
    build({ ...common, ...fromPkg, entryPoints: WORKERS, outdir: workersDir }),
    writeExtensionHostIframe({ pkgRoot, workersDir }),
    writeWebviewHost({ pkgRoot, editorDir }),
    // The webview host injects it as a classic script before the content's own, so it is not a module.
    build({ ...common, ...fromPkg, format: "iife", entryPoints: [resolve(pkgRoot, "src/editor/webview/contentApi.ts")], outfile: join(editorDir, "webview/vscodeApi.js") }),
    copyTypstCompiler(pkgRoot, editorDir),
    copyBundledExtensions({
      outDir,
      pkgRoot,
      // Tinymist's extension starts its server as a classic worker, so the bundle must not be a module.
      buildTinymistServer: (outfile) => build({ ...common, ...fromPkg, format: "iife", entryPoints: [resolve(pkgRoot, "src/editor/workers/tinymistServer.ts")], outfile }),
    }),
  ]);
}
