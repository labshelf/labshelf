/**
 * Makes monaco-vscode-api's worker extension host and typst.ts run under the extension pages' CSP (no eval, no blob: workers,
 * no inline script): exact-text patches applied while bundling, and the extension-host iframe rewritten into an html and a script file.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const EXT_HOST = "monaco-vscode-api/vscode/src/vs/workbench/api/worker/";
const TYPST_COMPILER = "typst-ts-web-compiler/pkg/typst_ts_web_compiler.mjs";

/** Each patch must find its text, so an upgrade of the pinned version fails the build instead of shipping unpatched. */
const PATCHES = [
  {
    file: `${EXT_HOST}extHostExtensionService.js`,
    // Loads the build-wrapped `<entry>.esm.js` (see bundledExtensions.mjs) instead of evaluating the entry's source.
    from: 'initFn = ( new Function("module", "exports", "require", fullSource));',
    to: 'initFn = (await import(/* webpackIgnore: true */ browserUri.toString(true) + ".esm.js")).default;',
  },
  {
    file: `${EXT_HOST}extHostExtensionService.js`,
    // Checks the wrapped entry exists rather than downloading the entry's source, which the patched loader never evaluates.
    from: "const response = await fetch(( browserUri.toString(true)));",
    to: 'const response = await fetch(browserUri.toString(true) + ".esm.js", { method: "HEAD" });',
  },
  {
    file: `${EXT_HOST}extensionHostWorker.js`,
    // Extensions' own workers (Tinymist's LSP server) start from their real URL rather than a blob: trampoline.
    from: "return URL.createObjectURL(blob);",
    to: "return browserUrl;",
  },
  {
    file: "typst.ts/dist/esm/init.mjs",
    // loadFonts builds a Node-only import through eval before it looks at its fetcher; the page passes font bytes and never fetches.
    from: "const escapeImport = new Function('m', 'return import(m)');",
    to: "const escapeImport = (m) => Promise.reject(new Error(`typst.ts cannot import ${m} in an extension page`));",
  },
  {
    file: TYPST_COMPILER,
    // The compiler builds its placeholder callbacks from source text; each known body maps to a function written out here.
    from: "function __wbg_get_imports() {",
    to: `const LABSHELF_KNOWN_FUNCTIONS = {
  "return 0": () => 0,
  "return true": () => true,
  "return this": function () { return this; },
  "path\\nreturn path": (path) => path,
  "throw new Error('Dummy AccessModel, please initialize compiler with withAccessModel()')": () => { throw new Error("Dummy AccessModel, please initialize compiler with withAccessModel()"); },
  "throw new Error('Dummy Registry, please initialize compiler with withPackageRegistry()')": () => { throw new Error("Dummy Registry, please initialize compiler with withPackageRegistry()"); },
};
function labshelfKnownFunction(args, body) {
  const known = LABSHELF_KNOWN_FUNCTIONS[args === undefined ? body : args + "\\n" + body];
  if (!known) throw new Error("typst.ts asked for a function the extension page cannot evaluate: " + JSON.stringify([args, body]));
  return known;
}
function __wbg_get_imports() {`,
  },
  { file: TYPST_COMPILER, from: "const ret = new Function(getStringFromWasm0(arg0, arg1));", to: "const ret = labshelfKnownFunction(undefined, getStringFromWasm0(arg0, arg1));" },
  {
    file: TYPST_COMPILER,
    from: "const ret = new Function(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));",
    to: "const ret = labshelfKnownFunction(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));",
  },
];

export const cspPatchPlugin = {
  name: "labshelf-csp-patches",
  setup(build) {
    for (const file of new Set(PATCHES.map((patch) => patch.file))) {
      const filter = new RegExp(`${file.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}$`);
      build.onLoad({ filter }, async (args) => {
        let source = await readFile(args.path, "utf8");
        for (const { from, to } of PATCHES.filter((patch) => patch.file === file)) {
          if (!source.includes(from)) throw new Error(`CSP patch target missing in ${args.path}: ${from}`);
          source = source.replace(from, to);
        }
        return { contents: source, loader: "js" };
      });
    }
  },
};

const BLOB_WORKER = /const blob = new Blob\(\[\[[\s\S]*?\]\.join\(''\)\], \{ type: 'application\/javascript' \}\);\s*const worker = new Worker\(URL\.createObjectURL\(blob\), \{ name, \.\.\.workerOptions \}\);/;
const STATIC_WORKER = `const worker = new Worker(new URL('extensionHostBootstrap.js', document.location.href), { name, type: 'module' });
			worker.postMessage({ type: '__bootstrap', workerUrl, fileRoot, nlsMessages, nlsLanguage });`;

/** Writes extensionHostIframe.html and .js into `workersDir`; the page returns that html for the iframe's worker label. */
export async function writeExtensionHostIframe({ pkgRoot, workersDir }) {
  // The package's exports map hides package.json, so its folder is found through the package's own node_modules link.
  const overrideRoot = join(pkgRoot, "node_modules/@codingame/monaco-vscode-extensions-service-override");
  const html = await readFile(join(overrideRoot, "vscode/src/vs/workbench/services/extensions/worker/webWorkerExtensionHostIframe.html"), "utf8");
  const inline = html.match(/<script>([\s\S]*)<\/script>/);
  if (!inline) throw new Error("No inline script in the extension host iframe");
  const script = inline[1].replace(BLOB_WORKER, STATIC_WORKER);
  if (script === inline[1]) throw new Error("Blob worker not found in the extension host iframe script");
  await writeFile(join(workersDir, "extensionHostIframe.js"), script);
  await writeFile(join(workersDir, "extensionHostIframe.html"), html.replace(inline[0], '<script src="extensionHostIframe.js"></script>'));
}
