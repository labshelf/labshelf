/** Bundles @labshelf/terminal into dist/labshelf.mjs (the `labshelf` command), dist/thumbnailWorker.mjs, dist/labshelf-helper.mjs (LabShelf Helper) and dist/helperHost.mjs (the terminal app as the browser's LaTeX helper), which are self-contained (pdf-lib is bundled; no PDF renderer, canvas or OCR), and dist/bridgeHost.js (the browser bridge host, an ES module that the launcher starts with Node). @labshelf/core is bundled from source; pdfjs-dist, Tesseract and the native canvas stay external and are loaded from node_modules at run time, only when a PDF is parsed, read by OCR or rendered. */
import { build, context } from "esbuild";
import { builtinModules } from "node:module";
import { chmod, copyFile, mkdir, rm } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BIBER_WASM_FILES, biberWasmDir } from "./biberWasm.mjs";
import { TYPST_WASM_FILE, typstWasmPath } from "./typstWasm.mjs";
import { CELL_DRIVER_FILES, cellDriverPath } from "./cellDrivers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const watch = process.argv.includes("--watch");

const banner = [
  "#!/usr/bin/env node",
  "import { createRequire as __labshelfCreateRequire } from 'node:module';",
  "const require = __labshelfCreateRequire(import.meta.url);",
].join("\n");

const TYPST_RENDERER = "@myriaddreamin/typst-ts-renderer";

const common = {
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "info",
  // Loaded lazily from node_modules: pdfjs reads its data files next to itself, the canvas is a native module. pdf-lib is plain JavaScript and is bundled.
  // TRAP: typst.ts dynamically imports its optional renderer peer, which is not installed; the helper only compiles, so that import never runs.
  external: ["pdfjs-dist", "pdfjs-dist/*", "@napi-rs/canvas", "tesseract.js", TYPST_RENDERER],
  banner: { js: banner },
};

const entries = [
  { ...common, entryPoints: [resolve(root, "src/terminalEntry.ts")], outfile: resolve(root, "dist/labshelf.mjs") },
  { ...common, entryPoints: [resolve(root, "src/libraryUi/thumbnailWorker.ts")], outfile: resolve(root, "dist/thumbnailWorker.mjs"), banner: { js: banner.split("\n").slice(1).join("\n") } },
  { ...common, entryPoints: [resolve(root, "src/helper/helperEntry.ts")], outfile: resolve(root, "dist/labshelf-helper.mjs"), metafile: true, banner: { js: banner.split("\n").slice(1).join("\n") } },
  { ...common, entryPoints: [resolve(root, "src/helperHost.ts")], outfile: resolve(root, "dist/helperHost.mjs"), metafile: true, banner: { js: banner.split("\n").slice(1).join("\n") } },
  { ...common, entryPoints: [resolve(root, "../core/src/bridge/node/hostEntry.ts")], outfile: resolve(root, "dist/bridgeHost.js"), banner: { js: banner.split("\n").slice(1).join("\n") } },
];

// The helper starts on every browser launch of a native-messaging host; it never needs the PDF renderer, the canvas or OCR. pdf-lib is bundled into it (page diffs), so it is not forbidden.
const HELPER_FORBIDDEN = /(^|[/\\])(pdfjs-dist|@napi-rs[/\\]canvas|tesseract\.js)([/\\]|$)/;

const isNodeBuiltin = (path) => path.startsWith("node:") || builtinModules.includes(path);

function assertHelperBundle(result, name) {
  const outputKey = Object.keys(result.metafile.outputs).find((key) => key.endsWith(`/${name}`) || key === name);
  if (!outputKey) { throw new Error(`${name} is missing from the build metafile`); }
  const output = result.metafile.outputs[outputKey];
  const offenders = [...Object.keys(result.metafile.inputs), ...output.imports.map((entry) => entry.path)].filter((entry) => HELPER_FORBIDDEN.test(entry));
  if (offenders.length > 0) {
    throw new Error(`${name} must not import the PDF renderer, canvas or OCR, but the bundle reaches: ${[...new Set(offenders)].join(", ")}`);
  }
  // The executable ships without node_modules, so the only imports left are Node built-ins.
  const external = output.imports.filter((entry) => entry.external && !isNodeBuiltin(entry.path) && entry.path !== TYPST_RENDERER);
  if (external.length > 0) {
    throw new Error(`${name} must be self-contained, but it imports: ${[...new Set(external.map((entry) => entry.path))].join(", ")}`);
  }
}

// The helper script loads nothing from node_modules, so its Typst compiler WASM sits beside it (`runHelperScriptHost` reads it there).
await mkdir(resolve(root, "dist"), { recursive: true });
await copyFile(typstWasmPath(), resolve(root, "dist", TYPST_WASM_FILE));
// `runHelperScriptHost` runs the cell drivers from beside the script too.
await Promise.all(CELL_DRIVER_FILES.map((file) => copyFile(cellDriverPath(file), resolve(root, "dist", file))));
// `runHelperScriptHost` reads biber's WASM from dist/biber-wasm/ beside the script.
const biberDir = biberWasmDir();
if (biberDir) {
  await mkdir(resolve(root, "dist/biber-wasm"), { recursive: true });
  await Promise.all(BIBER_WASM_FILES.map((file) => copyFile(resolve(biberDir, file), resolve(root, "dist/biber-wasm", file))));
} else {
  await rm(resolve(root, "dist/biber-wasm"), { recursive: true, force: true });
  console.log("[labshelf-terminal] no biber WASM build; LaTeX builds run the TeX's own biber");
}

if (watch) {
  for (const options of entries) {
    const ctx = await context(options);
    await ctx.watch();
  }
  console.log("[labshelf-terminal] watching…");
} else {
  const results = await Promise.all(entries.map((options) => build(options)));
  entries.forEach((options, index) => {
    if (options.metafile) assertHelperBundle(results[index], basename(options.outfile));
  });
  await chmod(resolve(root, "dist/labshelf.mjs"), 0o755);
  console.log("[labshelf-terminal] built dist/labshelf.mjs");
}
