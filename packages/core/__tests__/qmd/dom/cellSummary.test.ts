/**
 * Tests cellSummary (D8): the one summary line '<Language> · <kind> · ran <when>' of a collapsed code cell, built from the code cell node, its output nodes and a clock.
 * Kind words are text, LaTeX, 2D plot, 3D plot, image, error and no output; the when is 'ran 5 min ago', 'ran yesterday', 'ran 3 Mar', or 'not run' with no output.
 * The state is 'error' for an error output, 'ok' for a result and 'none' without one. The out-of-date states depend on the document and the plugin state and are tested through the view in foldPlugin.test.ts.
 */
import type { Node as PmNode } from "prosemirror-model";
import { qmdSchema as s } from "../../../src/qmd/editor/qmdSchema";
import { formatOutput, formatPlotContent } from "../../../src/qmd/item/cellOutput";
import type { PlotSpec } from "../../../src/qmd/item/plotSpec";
import { cellSummary } from "../../../src/qmd/dom/cellSummary";

const NOW = new Date("2026-10-22T09:20:03.000Z");
const FIVE_MIN_AGO = "2026-10-22T09:15:03.000Z";
const PNG = "data:image/png;base64,iVBORw0KGgo=";
const SPEC_2D: PlotSpec = { v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [{ type: "line", x: [0, 1, 2], y: [0, 1, 0] }] };
const SPEC_3D: PlotSpec = { v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces: [{ type: "surface", x: [0, 1], y: [0, 1], z: [[0, 1], [1, 0]] }] };

function cell(lang: string, label = "a"): PmNode {
  return s.node("code_cell", { lang, options: `#| label: ${label}\n`, code: "x = 1\n", info: `{${lang}}` });
}

function output(content: string, opts: { ran?: string; status?: "error"; label?: string; engine?: string } = {}): PmNode {
  const label = opts.label ?? "a";
  const ran = opts.ran ?? FIVE_MIN_AGO;
  const engine = opts.engine ?? "python-3.12";
  const raw = formatOutput({ cell: label, source: "abc123def456", engine, ran, content, ...(opts.status ? { status: opts.status } : {}) });
  return s.node("output", { cell: label, source: "abc123def456", engine, ran, raw });
}

describe("cellSummary", () => {
  it("3.1a writes 'Python · text · ran 5 min ago' for a python cell with a text output", () => {
    const summary = cellSummary(cell("python"), [output("hello\n")], NOW);
    expect(summary.text).toBe("Python · text · ran 5 min ago");
    expect(summary.state).toBe("ok");
  });

  it("3.1a names the language as the language picker shows it: R and Mathematica", () => {
    expect(cellSummary(cell("r"), [output("[1] 1\n", { engine: "r-4.4" })], NOW).text).toMatch(/^R · text · ran /);
    expect(cellSummary(cell("mathematica"), [output("2\n", { engine: "wolframscript" })], NOW).text).toMatch(/^Mathematica · /);
  });

  it("3.1a says error as the kind, keeps the error state and never reports ok", () => {
    const summary = cellSummary(cell("python"), [output("Traceback: boom\n", { status: "error" })], NOW);
    expect(summary.text).toBe("Python · error · ran 5 min ago");
    expect(summary.text).toContain("error");
    expect(summary.state).toBe("error");
  });

  it("3.1a says 'no output' and 'not run' for a cell without output, with state none", () => {
    const summary = cellSummary(cell("python"), [], NOW);
    expect(summary.text).toBe("Python · no output · not run");
    expect(summary.state).toBe("none");
  });

  it("3.1a says image for an output that is one embedded PNG", () => {
    const summary = cellSummary(cell("python"), [output(`![Python plot](${PNG})\n`)], NOW);
    expect(summary.text).toMatch(/^Python · image · ran /);
    expect(summary.state).toBe("ok");
  });

  it("3.1a says 2D plot for an output with a 2D plot spec", () => {
    const content = formatPlotContent({ alt: "Python plot", src: PNG }, SPEC_2D);
    expect(cellSummary(cell("python"), [output(content)], NOW).text).toMatch(/^Python · 2D plot · ran /);
  });

  it("3.1a says 3D plot for an output with a 3D plot spec", () => {
    const content = formatPlotContent({ alt: "Python plot", src: PNG }, SPEC_3D);
    expect(cellSummary(cell("python"), [output(content)], NOW).text).toMatch(/^Python · 3D plot · ran /);
  });

  it("3.1a says 'ran yesterday' when the output ran on the day before now", () => {
    const now = new Date(2026, 2, 10, 12, 0, 0);
    const ran = new Date(2026, 2, 9, 12, 0, 0).toISOString();
    expect(cellSummary(cell("python"), [output("hello\n", { ran })], now).text).toBe("Python · text · ran yesterday");
  });

  it("3.1a says 'ran 3 Mar' when the output ran a week before now", () => {
    const now = new Date(2026, 2, 10, 12, 0, 0);
    const ran = new Date(2026, 2, 3, 12, 0, 0).toISOString();
    expect(cellSummary(cell("python"), [output("hello\n", { ran })], now).text).toBe("Python · text · ran 3 Mar");
  });

  it("A6 gives each of ok, error and none its own state", () => {
    const states = [
      cellSummary(cell("python"), [output("hello\n")], NOW).state,
      cellSummary(cell("python"), [output("boom\n", { status: "error" })], NOW).state,
      cellSummary(cell("python"), [], NOW).state,
    ];
    expect(states).toEqual(["ok", "error", "none"]);
  });

  it("3.1c does not change the nodes it reads", () => {
    const code = cell("python");
    const out = output("hello\n");
    const before = [JSON.stringify(code.toJSON()), JSON.stringify(out.toJSON())];
    cellSummary(code, [out], NOW);
    expect([JSON.stringify(code.toJSON()), JSON.stringify(out.toJSON())]).toEqual(before);
  });
});
