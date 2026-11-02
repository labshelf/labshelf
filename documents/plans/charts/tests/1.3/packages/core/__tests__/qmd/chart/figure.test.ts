/**
 * Tests chartFigure (plan charts, D1, D3): the Plotly figure of a chart model and its table for scatter (lines, markers,
 * area fill), bar and pie, coloured from the theme palette; function charts give no traces yet. The module is DOM-free.
 */
import { chartFigure, type ChartFigure } from "../../../src/qmd/chart/figure";
import type { ChartModel, ChartTable, ChartTrace } from "../../../src/qmd/chart/model";

const THEME = { fg: "#112233", muted: "#778899", grid: "#445566", font: "Test Sans", palette: ["#aa0000", "#00aa00", "#0000aa"] as const };

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [1, 2, 3, 4] },
    { name: "v", values: [10, 20, null, 40] },
    { name: "w", values: [5, 6, 7, 8] },
  ],
};

const LABELS: ChartTable = {
  cols: [
    { name: "kind", values: ["a", "b", "c"] },
    { name: "count", values: [3, 5, 2] },
  ],
};

function model(traces: ChartTrace[], extra: Partial<ChartModel> = {}): ChartModel {
  return {
    v: 1,
    id: "a1b2c3d4",
    kind: "data",
    traces,
    fns: [],
    vars: [],
    layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } },
    ...extra,
  };
}

const figureOf = (traces: ChartTrace[], table: ChartTable | null = TABLE, extra: Partial<ChartModel> = {}): ChartFigure =>
  chartFigure(model(traces, extra), table, THEME);

const trace = (figure: ChartFigure, index = 0): Record<string, unknown> => {
  const found = figure.data[index];
  if (!found) throw new Error(`trace ${index} is missing`);
  return found;
};
const json = (value: unknown): string => JSON.stringify(value);

describe("chartFigure columns to x and y", () => {
  it("1.3b maps the x and y columns of a line trace to a scatter trace with mode lines", () => {
    const figure = figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }]);
    expect(figure.data).toHaveLength(1);
    const first = trace(figure);
    expect(first.type).toBe("scatter");
    expect(first.mode).toBe("lines");
    expect(first.x).toEqual([1, 2, 3, 4]);
    expect(first.y).toEqual([10, 20, null, 40]);
  });

  it("1.3b maps a scatter trace of markers to mode markers", () => {
    const first = trace(figureOf([{ type: "scatter", x: "A", y: "C", mode: "markers" }]));
    expect(first.type).toBe("scatter");
    expect(first.mode).toBe("markers");
    expect(first.x).toEqual([1, 2, 3, 4]);
    expect(first.y).toEqual([5, 6, 7, 8]);
  });

  it("1.3b keeps the lines+markers mode", () => {
    expect(trace(figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines+markers" }])).mode).toBe("lines+markers");
  });

  it("1.3b keeps the area fill of a scatter trace", () => {
    const first = trace(figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines", fill: "tozeroy" }]));
    expect(first.type).toBe("scatter");
    expect(first.fill).toBe("tozeroy");
    expect(first.y).toEqual([10, 20, null, 40]);
  });

  it("1.3b maps the columns of a bar trace to a bar trace", () => {
    const first = trace(figureOf([{ type: "bar", x: "A", y: "C" }]));
    expect(first.type).toBe("bar");
    expect(first.x).toEqual([1, 2, 3, 4]);
    expect(first.y).toEqual([5, 6, 7, 8]);
  });

  it("1.3b maps a pie trace to labels from the x column and values from the y column", () => {
    const first = trace(figureOf([{ type: "pie", x: "A", y: "B" }], LABELS));
    expect(first.type).toBe("pie");
    expect(first.labels).toEqual(["a", "b", "c"]);
    expect(first.values).toEqual([3, 5, 2]);
  });

  it("1.3b gives one trace per model trace, in order, with the trace name", () => {
    const figure = figureOf([
      { type: "scatter", x: "A", y: "B", mode: "lines", name: "first" },
      { type: "bar", x: "A", y: "C", name: "second" },
    ]);
    expect(figure.data).toHaveLength(2);
    expect(trace(figure, 0).name).toBe("first");
    expect(trace(figure, 0).type).toBe("scatter");
    expect(trace(figure, 1).name).toBe("second");
    expect(trace(figure, 1).type).toBe("bar");
  });

  it("1.3b reads the columns from the table given, not from the model, so a table loaded from src draws", () => {
    const figure = figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }], TABLE, { src: "assets/a1b2c3d4.csv" });
    expect(trace(figure).y).toEqual([10, 20, null, 40]);
  });

  it("1.3b gives no traces when there is no table", () => {
    expect(figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }], null).data).toEqual([]);
  });
});

describe("chartFigure theme", () => {
  it("1.3b colours the first trace with the first palette colour and the second with the second", () => {
    const figure = figureOf([
      { type: "scatter", x: "A", y: "B", mode: "lines" },
      { type: "scatter", x: "A", y: "C", mode: "lines" },
    ]);
    expect(json(trace(figure, 0))).toContain(THEME.palette[0]);
    expect(json(trace(figure, 0))).not.toContain(THEME.palette[1]);
    expect(json(trace(figure, 1))).toContain(THEME.palette[1]);
    expect(json(trace(figure, 1))).not.toContain(THEME.palette[0]);
  });

  it("1.3b colours the bars of a bar trace with the palette", () => {
    const first = trace(figureOf([{ type: "bar", x: "A", y: "C" }]));
    expect(json(first)).toContain(THEME.palette[0]);
  });

  it("1.3b colours the slices of a pie trace with the palette in order", () => {
    const text = json(trace(figureOf([{ type: "pie", x: "A", y: "B" }], LABELS)));
    for (const colour of THEME.palette) expect(text).toContain(colour);
    expect(text.indexOf(THEME.palette[0])).toBeLessThan(text.indexOf(THEME.palette[1]));
    expect(text.indexOf(THEME.palette[1])).toBeLessThan(text.indexOf(THEME.palette[2]));
  });

  it("1.3b prefers the colour of a trace over the palette", () => {
    const first = trace(figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines", color: "#123456" }]));
    expect(json(first)).toContain("#123456");
    expect(json(first)).not.toContain(THEME.palette[0]);
  });

  it("1.3b sets the layout font to the theme font and text colour", () => {
    const layout = figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }]).layout as { font?: { color?: string; family?: string } };
    expect(layout.font?.color).toBe(THEME.fg);
    expect(layout.font?.family).toBe(THEME.font);
  });
});

describe("chartFigure layout", () => {
  it("1.3b puts the chart title in the layout", () => {
    const figure = figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }], TABLE, { title: "Growth" });
    expect(json(figure.layout)).toContain("Growth");
  });

  it("1.3b applies the axis titles, the log type and the range of the model layout", () => {
    const figure = figureOf([{ type: "scatter", x: "A", y: "B", mode: "lines" }], TABLE, {
      layout: {
        xaxis: { type: "linear", title: "Time (s)", range: [0, 10] },
        yaxis: { type: "log", title: "Level" },
        legend: { show: false },
      },
    });
    const layout = figure.layout as { xaxis?: { title?: unknown; range?: number[] }; yaxis?: { type?: string; title?: unknown }; showlegend?: boolean };
    expect(json(layout.xaxis?.title)).toContain("Time (s)");
    expect(layout.xaxis?.range).toEqual([0, 10]);
    expect(layout.yaxis?.type).toBe("log");
    expect(json(layout.yaxis?.title)).toContain("Level");
    expect(layout.showlegend).toBe(false);
  });
});

describe("chartFigure function charts", () => {
  it("1.3b gives a 2D function chart the traces of its visible function, with finite points", () => {
    const figure = figureOf([], null, { kind: "fn2d", fns: [{ kind: "y", expr: ["x^2"] }] });
    expect(figure.data.length).toBeGreaterThanOrEqual(1);
    const xs = figure.data.flatMap((t) => (Array.isArray(t.x) ? (t.x as unknown[]) : []));
    const ys = figure.data.flatMap((t) => (Array.isArray(t.y) ? (t.y as unknown[]) : []));
    expect(xs.some((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
    expect(ys.some((v) => typeof v === "number" && Number.isFinite(v))).toBe(true);
  });

  it("1.3b gives no traces for a hidden function of a 2D function chart", () => {
    const figure = figureOf([], null, { kind: "fn2d", fns: [{ kind: "y", expr: ["x^2"], hidden: true }] });
    expect(figure.data).toEqual([]);
  });
});
