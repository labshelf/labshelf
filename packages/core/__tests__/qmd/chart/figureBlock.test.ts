// The figure block: one labshelf-figure div for drawings, plots and data; the earlier drawing and chart blocks read as figures.
import { formatDrawingBlock } from "../../../src/drawing/index";
import { emptyFigure, figurePlotly, formatChartBlock, formatFigureBlock, panelCharts, readFigureBlock, readFigureModel, EXPORT_THEME, type FigureModel } from "../../../src/qmd/chart/index";

const PNG = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", widthCm: 12, alt: "A figure" };
const DRAWING = { v: 1 as const, points: [{ id: "a", x: 0, y: 0, dot: true }, { id: "b", x: 2, y: 1, dot: true }], items: [{ k: "seg" as const, a: "a", b: "b", arrow: "none" as const }] };

const plot = (): FigureModel => ({
  ...emptyFigure("plot", "0a1b2c3d"),
  fns: [{ kind: "y", expr: ["sin(x)"] }, { kind: "surface", expr: ["x*y"], panel: 1, render: "both", resolution: "low", opacity: 0.8 }],
  vars: [{ name: "a", value: 1 }],
  panels: [{ dims: 2, layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } } }, { dims: 3, layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, zaxis: { type: "linear" }, legend: { show: true } } }],
});

describe("figure model", () => {
  it("reads a plot with panels and the fields functions gained", () => {
    const model = readFigureModel(plot());
    expect(model?.panels).toHaveLength(2);
    expect(model?.fns[1]).toMatchObject({ panel: 1, render: "both", resolution: "low", opacity: 0.8 });
  });

  it("refuses a function on a panel that does not exist", () => {
    expect(readFigureModel({ ...plot(), fns: [{ kind: "y", expr: ["x"], panel: 4 }] })).toBeNull();
  });

  it("draws one chart per panel, each with its own functions", () => {
    const charts = panelCharts(plot());
    expect(charts.map((c) => c.kind)).toEqual(["fn2d", "fn3d"]);
    expect(charts.map((c) => c.fns.length)).toEqual([1, 1]);
  });

  it("puts several panels into one Plotly figure, each on its own axes or scene", () => {
    const figure = figurePlotly(plot(), null, EXPORT_THEME);
    expect(figure.layout.xaxis).toBeDefined();
    expect(figure.layout.scene2).toBeDefined();
    expect(figure.data.some((trace) => trace.scene === "scene2")).toBe(true);
  });
});

describe("figure block", () => {
  it("writes and reads back a plot figure without a picture", () => {
    const text = formatFigureBlock({ model: plot(), png: PNG, picture: null, svg: null });
    expect(text).toMatch(/^::: \{\.labshelf-figure source=[0-9a-f]{12}\}/);
    const read = readFigureBlock(text!);
    expect(read?.model).toEqual(readFigureModel(plot()));
    expect(read?.png).toEqual(PNG);
    expect(read?.handEdited).toBe(false);
  });

  it("writes a drawing with its TikZ guard and SVG, and refuses one without its SVG", () => {
    const model: FigureModel = { ...emptyFigure("drawing", "0a1b2c3e"), drawing: DRAWING };
    const text = formatFigureBlock({ model, png: PNG, picture: "\\begin{tikzpicture}\\end{tikzpicture}", svg: "<svg width=\"10\"></svg>" });
    expect(text).toContain("\\@ifundefined{tikzpicture}");
    expect(readFigureBlock(text!)?.svg).toBe("<svg width=\"10\"></svg>");
    expect(formatFigureBlock({ model, png: PNG, picture: null, svg: null })).toBeNull();
  });

  it("reads an earlier drawing block as a drawing figure", () => {
    const raw = formatDrawingBlock({ model: DRAWING, tikz: "\\begin{tikzpicture}\\end{tikzpicture}", png: PNG.dataUrl, alt: "Old", svg: "<svg width=\"38\"></svg>" }, "\n")!;
    const read = readFigureBlock(raw);
    expect(read?.model.kind).toBe("drawing");
    expect(read?.model.drawing).toEqual(DRAWING);
    expect(read?.picture).toBe("\\begin{tikzpicture}\\end{tikzpicture}");
  });

  it("reads an earlier chart block as a one-panel plot", () => {
    const chart = { v: 1 as const, id: "0a1b2c3f", kind: "fn3d" as const, traces: [], fns: [{ kind: "surface" as const, expr: ["x"] }], vars: [], layout: { xaxis: { type: "linear" as const }, yaxis: { type: "linear" as const }, legend: { show: true } } };
    const read = readFigureBlock(formatChartBlock({ model: chart, png: null, pgf: null })!);
    expect(read?.model.kind).toBe("plot");
    expect(read?.model.panels?.map((p) => p.dims)).toEqual([3]);
  });
});
