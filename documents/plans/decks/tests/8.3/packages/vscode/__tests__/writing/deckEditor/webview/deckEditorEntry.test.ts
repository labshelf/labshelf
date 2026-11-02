/** @jest-environment node */
// Tests the deck editor bundle's size budget (D13): at most 1 MB of added minified JavaScript outside MathJax and CodeMirror, with the editor code in a lazy chunk.
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const pkgRoot = path.resolve(__dirname, "../../../..");
const webviewsScript = path.join(pkgRoot, "build", "webviews.mjs");
const BUDGET = 1_048_576;

interface MetaOutput { entryPoint?: string; bytes: number; inputs: Record<string, { bytesInOutput: number }>; imports: Array<{ path: string; kind: string; external?: boolean }> }
interface Metafile { inputs: Record<string, unknown>; outputs: Record<string, MetaOutput> }

// Builds in a child process so esbuild and webviews.mjs never run inside jest; webviews.mjs is imported only, never executed as main.
const CHILD = `
import { createRequire } from "node:module";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const [script, pkgJson, outRoot] = process.argv.slice(1);
const require = createRequire(pkgJson);
const esbuildModule = await import(pathToFileURL(require.resolve("esbuild")).href);
const build = esbuildModule.build ?? esbuildModule.default.build;
const { webviewBundleOptions } = await import(pathToFileURL(script).href);
const deck = await build(webviewBundleOptions("deckEditor/deckEditor", { outdir: join(outRoot, "deck"), minify: true, metafile: true, write: true, logLevel: "silent" }));
const source = await build(webviewBundleOptions("sourceEditor/sourceEditor", { outdir: join(outRoot, "source"), minify: true, metafile: true, write: true, logLevel: "silent" }));
writeFileSync(join(outRoot, "deck.meta.json"), JSON.stringify(deck.metafile));
writeFileSync(join(outRoot, "source.meta.json"), JSON.stringify(source.metafile));
`;

let outRoot = "";
let deck: Metafile;
let source: Metafile;

beforeAll(() => {
  const text = fs.readFileSync(webviewsScript, "utf8");
  // Importing an unguarded webviews.mjs would run main() and wipe dist/; refuse before importing it.
  if (!/export\s+(async\s+)?function\s+webviewBundleOptions\b|export\s*\{[^}]*\bwebviewBundleOptions\b/.test(text)) {
    throw new Error("build/webviews.mjs does not export webviewBundleOptions");
  }
  outRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-size-")));
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", CHILD, webviewsScript, path.join(pkgRoot, "package.json"), outRoot], {
    cwd: pkgRoot, encoding: "utf8", timeout: 280_000,
  });
  if (result.status !== 0) {
    throw new Error(`deck editor build failed (${result.status ?? result.signal}): ${result.stderr || result.error?.message || ""}`);
  }
  deck = JSON.parse(fs.readFileSync(path.join(outRoot, "deck.meta.json"), "utf8"));
  source = JSON.parse(fs.readFileSync(path.join(outRoot, "source.meta.json"), "utf8"));
}, 300_000);

afterAll(() => {
  if (outRoot) { fs.rmSync(outRoot, { recursive: true, force: true }); }
});

const SHIPPED = [/node_modules\/mathjax[^/]*\//, /node_modules\/@codemirror\//, /node_modules\/@lezer\//];
const DECK_EDITOR_CODE = /core\/(src|dist)\/decks\/editor\//;

function jsOutputs(meta: Metafile): Array<[string, MetaOutput]> {
  return Object.entries(meta.outputs).filter(([file]) => /\.m?js$/.test(file));
}

function staticClosure(meta: Metafile, entry: string): Set<string> {
  const seen = new Set<string>([entry]);
  const queue = [entry];
  while (queue.length > 0) {
    const current = meta.outputs[queue.shift()!];
    for (const edge of current?.imports ?? []) {
      if (edge.kind === "import-statement" && !edge.external && !seen.has(edge.path)) { seen.add(edge.path); queue.push(edge.path); }
    }
  }
  return seen;
}

describe("deck editor bundle size", () => {
  it("8.3e adds at most 1 MB of minified JavaScript outside MathJax, CodeMirror and the source editor's inputs", () => {
    const sourceInputs = new Set(Object.keys(source.inputs));
    let added = 0;
    for (const [, output] of jsOutputs(deck)) {
      for (const [input, info] of Object.entries(output.inputs)) {
        const normalized = input.split(path.sep).join("/");
        if (SHIPPED.some((pattern) => pattern.test(normalized)) || sourceInputs.has(input)) { continue; }
        added += info.bytesInOutput;
      }
    }
    expect(added).toBeGreaterThan(0);
    expect(added).toBeLessThanOrEqual(BUDGET);
  });

  it("8.3e keeps the core deck editor code in a lazy chunk, not in the entry file", () => {
    const outputs = jsOutputs(deck);
    const entry = outputs.find(([, output]) => output.entryPoint !== undefined);
    expect(entry).toBeDefined();
    const eager = staticClosure(deck, entry![0]);
    const holdsEditor = (output: MetaOutput) => Object.keys(output.inputs).some((input) => DECK_EDITOR_CODE.test(input.split(path.sep).join("/")));
    expect(holdsEditor(entry![1])).toBe(false);
    const eagerWithEditor = outputs.filter(([file, output]) => eager.has(file) && holdsEditor(output)).map(([file]) => file);
    expect(eagerWithEditor).toEqual([]);
    const lazyWithEditor = outputs.filter(([file, output]) => !eager.has(file) && holdsEditor(output));
    expect(lazyWithEditor.length).toBeGreaterThan(0);
  });
});
