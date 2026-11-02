/**
 * Tests chartFigure for the options of spec 4.2 (plan charts, D1, D3): colourscales, transpose, legend, axis titles, log type,
 * ranges, grid lines, ticks, font size, bar mode, and the z axis and camera of the 3D scene. The module is DOM-free.
 */
import { chartFigure } from "../../../src/qmd/chart/figure";
import type { ChartLayout, ChartModel, ChartTable, ChartTrace } from "../../../src/qmd/chart/model";

const THEME = { fg: "#112233", muted: "#778899", grid: "#445566", font: "Test Sans", palette: ["#aa0000", "#00aa00", "#0000aa"] as const };

const TABLE: ChartTable = {
  cols: [
    { name: "x", values: [1, 2, 3] },
    { name: "y", values: [10, 20, 30] },
    { name: "z1", values: [100, 200, 300] },
    { name: "z2", values: [400, 500, 600] },
  ],
};

const BASE_LAYOUT: ChartLayout = { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } };

function model(traces: ChartTrace[], layout: Partial<ChartLayout> = {}): ChartModel {
  return { v: 1, id: "a1b2c3d4", kind: "data", traces, fns: [], vars: [], layout: { ...BASE_LAYOUT, ...layout } };
}

const figure = (traces: ChartTrace[], layout: Partial<ChartLayout> = {}) => chartFigure(model(traces, layout), TABLE, THEME);
const layoutOf = (traces: ChartTrace[], layout: Partial<ChartLayout> = {}): Record<string, any> => figure(traces, layout).layout as Record<string, any>;
const LINE: ChartTrace = { type: "scatter", x: "A", y: "B", mode: "lines" };
const SURFACE: ChartTrace = { type: "surface", x: "A", y: "B", z: ["C", "D"] };
const json = (value: unknown): string => JSON.stringify(value);

describe("chartFigure draws every trace type", () => {
  it.each([
    ["heatmap", { type: "heatmap", x: "A", y: "B", z: ["C", "D"] }],
    ["contour", { type: "contour", x: "A", y: "B", z: ["C", "D"] }],
    ["surface", { type: "surface", x: "A", y: "B", z: ["C", "D"] }],
    ["scatter3d", { type: "scatter3d", x: "A", y: "B", z: ["C"] }],
    ["mesh3d", { type: "mesh3d", x: "A", y: "B", z: ["C"] }],
    ["histogram", { type: "histogram", x: "A" }],
    ["box", { type: "box", y: "B" }],
  ] as [string, ChartTrace][])("4.2a gives one %s trace in the figure", (type, trace) => {
    const data = figure([trace]).data;
    expect(data).toHaveLength(1);
    expect(data[0]!.type).toBe(type);
  });

  it("4.2a keeps drawing the other traces when one trace is of a newly drawn type", () => {
    const data = figure([LINE, { type: "histogram", x: "A" }]).data;
    expect(data.map((t) => t.type)).toEqual(["scatter", "histogram"]);
  });

  it("4.2a colours each trace of the figure from the palette by its index", () => {
    const data = figure([LINE, { type: "bar", x: "A", y: "B" }]).data;
    expect(json(data[0])).toContain(THEME.palette[0]);
    expect(json(data[1])).toContain(THEME.palette[1]);
  });
});

describe("chartFigure colourscales", () => {
  const HEAT: ChartTrace = { type: "heatmap", x: "A", y: "B", z: ["C", "D"] };

  it("4.2a falls back to Viridis for a heatmap with no colourscale anywhere", () => {
    expect(figure([HEAT]).data[0]!.colorscale).toBe("Viridis");
  });

  it("4.2a takes the colourscale of the layout when the trace has none", () => {
    expect(figure([HEAT], { colorscale: "Hot" }).data[0]!.colorscale).toBe("Hot");
  });

  it("4.2a prefers the colourscale of the trace over that of the layout", () => {
    expect(figure([{ ...HEAT, colorscale: "Blues" }], { colorscale: "Hot" }).data[0]!.colorscale).toBe("Blues");
  });

  it("4.2a shows the colour bar of a heatmap in the figure", () => {
    expect(figure([HEAT]).data[0]!.showscale).toBe(true);
  });
});

describe("chartFigure transpose", () => {
  it("4.2b swaps the z matrix of the figure when transpose is true", () => {
    const plain = figure([{ type: "heatmap", x: "A", y: "B", z: ["C", "D"] }]).data[0]!;
    const swapped = figure([{ type: "heatmap", x: "A", y: "B", z: ["C", "D"], transpose: true }]).data[0]!;
    expect(plain.z).toEqual([[100, 400], [200, 500], [300, 600]]);
    expect(swapped.z).toEqual([[100, 200, 300], [400, 500, 600]]);
  });
});

describe("chartFigure layout options", () => {
  it("4.2b applies the axis titles to the layout", () => {
    const layout = layoutOf([LINE], { xaxis: { type: "linear", title: "Time (s)" }, yaxis: { type: "linear", title: "Level" } });
    expect(json(layout.xaxis.title)).toContain("Time (s)");
    expect(json(layout.yaxis.title)).toContain("Level");
  });

  it("4.2b applies the log type of an axis", () => {
    const layout = layoutOf([LINE], { yaxis: { type: "log" } });
    expect(layout.yaxis.type).toBe("log");
    expect(layout.xaxis.type).toBe("linear");
  });

  it("4.2b applies the range of an axis", () => {
    const layout = layoutOf([LINE], { xaxis: { type: "linear", range: [0, 10] } });
    expect(layout.xaxis.range).toEqual([0, 10]);
  });

  it("4.2b applies the tick count of an axis", () => {
    const layout = layoutOf([LINE], { xaxis: { type: "linear", ticks: 6 } });
    expect(layout.xaxis.nticks).toBe(6);
  });

  it("4.2b hides the grid lines of an axis when grid is false and shows them by default", () => {
    const layout = layoutOf([LINE], { xaxis: { type: "linear", grid: false } });
    expect(layout.xaxis.showgrid).toBe(false);
    expect(layout.yaxis.showgrid).toBe(true);
  });

  it("4.2b sets the font size of the layout when the model has one", () => {
    const layout = layoutOf([LINE], { fontSize: 18 });
    expect(layout.font.size).toBe(18);
    expect(layout.font.color).toBe(THEME.fg);
    expect(layout.font.family).toBe(THEME.font);
  });

  it("4.2b leaves the font size out when the model has none", () => {
    expect(layoutOf([LINE]).font.size).toBeUndefined();
  });

  it("4.2b sets the bar mode when the model has one", () => {
    expect(layoutOf([{ type: "bar", x: "A", y: "B" }], { barmode: "stack" }).barmode).toBe("stack");
    expect(layoutOf([{ type: "bar", x: "A", y: "B" }], { barmode: "group" }).barmode).toBe("group");
  });

  it("4.2b leaves the bar mode out when the model has none", () => {
    expect(layoutOf([{ type: "bar", x: "A", y: "B" }]).barmode).toBeUndefined();
  });

  it("4.2b hides the legend when show is false", () => {
    expect(layoutOf([LINE], { legend: { show: false } }).showlegend).toBe(false);
  });

  it("4.2b positions the legend with x, y and orientation", () => {
    const layout = layoutOf([LINE], { legend: { show: true, x: 0.8, y: 0.2, orientation: "h" } });
    expect(layout.showlegend).toBe(true);
    expect(layout.legend.x).toBe(0.8);
    expect(layout.legend.y).toBe(0.2);
    expect(layout.legend.orientation).toBe("h");
  });
});

describe("chartFigure 3D scene", () => {
  it.each([
    ["surface", SURFACE],
    ["scatter3d", { type: "scatter3d", x: "A", y: "B", z: ["C"] }],
    ["mesh3d", { type: "mesh3d", x: "A", y: "B", z: ["C"] }],
  ] as [string, ChartTrace][])("4.2b puts the axes of a %s chart in layout.scene and none at the top level", (_type, trace) => {
    const layout = layoutOf([trace], { xaxis: { type: "linear", title: "X" }, yaxis: { type: "log", title: "Y" } });
    expect(layout.scene.xaxis.type).toBe("linear");
    expect(json(layout.scene.xaxis.title)).toContain("X");
    expect(layout.scene.yaxis.type).toBe("log");
    expect(json(layout.scene.yaxis.title)).toContain("Y");
    expect(layout.scene.zaxis.type).toBe("linear");
    expect("xaxis" in layout).toBe(false);
    expect("yaxis" in layout).toBe(false);
  });

  it("4.2b maps the z axis of the model into the scene", () => {
    const layout = layoutOf([SURFACE], { zaxis: { type: "log", title: "Height", range: [1, 100], ticks: 4, grid: false } });
    expect(layout.scene.zaxis.type).toBe("log");
    expect(json(layout.scene.zaxis.title)).toContain("Height");
    expect(layout.scene.zaxis.range).toEqual([1, 100]);
    expect(layout.scene.zaxis.nticks).toBe(4);
    expect(layout.scene.zaxis.showgrid).toBe(false);
  });

  it("4.2b maps range, ticks and grid of the x and y axes into the scene", () => {
    const layout = layoutOf([SURFACE], { xaxis: { type: "linear", range: [0, 5], ticks: 3, grid: false } });
    expect(layout.scene.xaxis.range).toEqual([0, 5]);
    expect(layout.scene.xaxis.nticks).toBe(3);
    expect(layout.scene.xaxis.showgrid).toBe(false);
  });

  it("4.2b puts the camera of the model in the scene", () => {
    const camera = { eye: { x: 1.5, y: 1.5, z: 1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };
    expect(layoutOf([SURFACE], { camera }).scene.camera).toEqual(camera);
  });

  it("4.2b leaves the camera out of the scene when the model has none", () => {
    expect(layoutOf([SURFACE]).scene.camera).toBeUndefined();
  });

  it("4.2b puts the axes in the scene when a 3D trace sits among 2D traces", () => {
    const layout = layoutOf([LINE, SURFACE]);
    expect(layout.scene).toBeDefined();
    expect("xaxis" in layout).toBe(false);
  });

  it("4.2b keeps the axes at the top level and adds no scene for a 2D chart", () => {
    const layout = layoutOf([LINE, { type: "heatmap", x: "A", y: "B", z: ["C", "D"] }]);
    expect(layout.scene).toBeUndefined();
    expect(layout.xaxis.type).toBe("linear");
    expect(layout.yaxis.type).toBe("linear");
  });

  it("4.2b keeps the legend and the font in the layout of a 3D chart", () => {
    const layout = layoutOf([SURFACE], { legend: { show: false }, fontSize: 12 });
    expect(layout.showlegend).toBe(false);
    expect(layout.font.size).toBe(12);
  });
});
