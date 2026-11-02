/**
 * Spec 6.3 (D13): the `./deckEditor` entry (packages/core/src/decks/dom/openDeckEditor.ts) bundles with esbuild to at most 1 MB minified.
 * MathJax (the latex hover module) and CodeMirror are already shipped by the extensions, so they are external and not counted.
 * The metafile shows the bundle reaches the source view, so the measured chunk is the editor with its source view.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("deck editor bundle size", () => {
  it("6.3d the ./deckEditor entry bundles to at most 1 MB minified, MathJax and CodeMirror not counted", () => {
    // __dirname is <repo>/packages/core/__tests__/decks: four levels up is the repo root.
    const root = path.resolve(__dirname, "../../../..");
    const esbuild = path.join(root, "node_modules", ".bin", "esbuild");
    const entry = path.join(root, "packages", "core", "src", "decks", "dom", "openDeckEditor.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-deck-editor-bundle-"));
    try {
      const outfile = path.join(dir, "deckEditor.js");
      const metafile = path.join(dir, "meta.json");
      const run = spawnSync(
        esbuild,
        [
          entry,
          "--bundle",
          "--minify",
          "--format=esm",
          "--platform=browser",
          "--external:*/latex/hover/index",
          "--external:*/latex/hover/index.js",
          "--external:@codemirror/state",
          "--external:@codemirror/view",
          "--external:@codemirror/commands",
          "--external:@codemirror/search",
          "--loader:.css=empty",
          "--log-level=error",
          `--metafile=${metafile}`,
          `--outfile=${outfile}`,
        ],
        { cwd: root, encoding: "utf8", timeout: 120000 },
      );
      expect(run.error).toBeUndefined();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      const inputs = Object.keys((JSON.parse(fs.readFileSync(metafile, "utf8")) as { inputs: Record<string, unknown> }).inputs);
      if (!inputs.some((input) => input.replace(/\\/g, "/").endsWith("src/decks/dom/deckSourceView.ts"))) {
        throw new Error("not implemented: the ./deckEditor bundle does not include decks/dom/deckSourceView.ts");
      }
      expect(fs.statSync(outfile).size).toBeLessThanOrEqual(1048576);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
