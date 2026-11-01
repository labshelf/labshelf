/** @jest-environment node */
/**
 * Bundle size of openDrawingEditor: the editor bundles with esbuild to at most 60 KB minified, MathJax not counted.
 * Split from openDrawingEditor.test.ts, which keeps the jsdom behavior tests.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("openDrawingEditor bundle size", () => {
  it("A7 the editor bundles to at most 60 KB minified, MathJax not counted", () => {
    // __dirname is <repo>/packages/core/__tests__/qmd/dom/drawingEditor: six levels up is the repo root.
    const root = path.resolve(__dirname, "../../../../../..");
    const esbuild = path.join(root, "node_modules", ".bin", "esbuild");
    const entry = path.join(root, "packages", "core", "src", "qmd", "dom", "drawingEditor", "openDrawingEditor.ts");
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "labshelf-editor-bundle-"));
    try {
      const outfile = path.join(dir, "editor.js");
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
          "--loader:.css=empty",
          "--log-level=error",
          `--outfile=${outfile}`,
        ],
        { cwd: root, encoding: "utf8", timeout: 60000 },
      );
      expect(run.error).toBeUndefined();
      expect(run.stderr).toBe("");
      expect(run.status).toBe(0);
      expect(fs.statSync(outfile).size).toBeLessThanOrEqual(61440);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
