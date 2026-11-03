/** @jest-environment node */
/**
 * Bundle size of the chart editor chunk (plan charts, D9, 2.1): openChartEditor bundles with esbuild to at most 150 KB minified,
 * Plotly and MathJax not counted (their lazy loaders' dynamic imports stay external, as they are separate chunks in production).
 */
import { build } from "esbuild";
import * as path from "node:path";
import { loadChartEditor } from "../../../../src/qmd/dom/figureEditor/index";

describe("chart editor chunk size", () => {
  it("A10 the chart editor chunk is at most 150 KB minified without Plotly and MathJax", async () => {
    // The lazy loader is the chunk's entry point: this check starts from it, and ignores what loading the module does in a Node environment.
    await loadChartEditor().catch(() => undefined);
    // __dirname is <repo>/packages/core/__tests__/qmd/dom/chartEditor: six levels up is the repo root.
    const root = path.resolve(__dirname, "../../../../../..");
    const entry = path.join(root, "packages", "core", "src", "qmd", "dom", "chartEditor", "openChartEditor.ts");
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      minify: true,
      format: "esm",
      platform: "browser",
      write: false,
      logLevel: "silent",
      absWorkingDir: root,
      external: ["plotly.js*", "mathjax*", "*/latex/hover/index", "*/latex/hover/index.js"],
      loader: { ".css": "empty" },
      outdir: path.join(root, "node_modules", ".cache", "chart-editor-size"),
    });
    expect(result.errors).toHaveLength(0);
    const bytes = result.outputFiles.filter((file) => file.path.endsWith(".js")).reduce((total, file) => total + file.contents.byteLength, 0);
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThanOrEqual(153600);
  }, 60000);
});
