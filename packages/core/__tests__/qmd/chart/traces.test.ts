/**
 * Tests traceData (plan charts, spec 4.2, D1, D3): one Plotly trace per chart trace for every data type and option,
 * read from the chart's table by column letter and coloured from the palette; text cells become null gaps. DOM-free.
 */
import { traceData } from "../../../src/qmd/chart/traces";
import type { ChartTable, ChartTrace } from "../../../src/qmd/chart/model";

const PALETTE = ["#aa0000", "#00aa00", "#0000aa"] as const;

// A x, B y, C z1, D z2, E labels, F numbers with a text cell
const TABLE: ChartTable = {
  cols: [
    { name: "x", values: [1, 2, 3] },
    { name: "y", values: [10, 20, 30] },
    { name: "z1", values: [100, 200, 300] },
    { name: "z2", values: [400, 500, 600] },
    { name: "label", values: ["a", "b", "c"] },
    { name: "mixed", values: [1, "n/a", 3] },
  ],
};

function one(trace: ChartTrace, index = 0, table: ChartTable = TABLE): Record<string, unknown> {
  const out = traceData(trace, table, PALETTE, index);
  expect(out).toHaveLength(1);
  return out[0]!;
}

const json = (value: unknown): string => JSON.stringify(value);

describe("traceData line, scatter and area", () => {
  it("4.2a maps a line trace to a scatter trace with mode lines and the x and y columns", () => {
    const t = one({ type: "scatter", x: "A", y: "B", mode: "lines" });
    expect(t.type).toBe("scatter");
    expect(t.mode).toBe("lines");
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.fill).toBeUndefined();
  });

  it("4.2a draws a scatter trace without a mode as lines", () => {
    expect(one({ type: "scatter", x: "A", y: "B" }).mode).toBe("lines");
  });

  it("4.2a maps a scatter trace of markers to mode markers", () => {
    expect(one({ type: "scatter", x: "A", y: "B", mode: "markers" }).mode).toBe("markers");
  });

  it("4.2a keeps the lines+markers mode", () => {
    expect(one({ type: "scatter", x: "A", y: "B", mode: "lines+markers" }).mode).toBe("lines+markers");
  });

  it("4.2a maps an area trace to fill tozeroy", () => {
    const t = one({ type: "scatter", x: "A", y: "B", mode: "lines", fill: "tozeroy" });
    expect(t.type).toBe("scatter");
    expect(t.fill).toBe("tozeroy");
  });

  it("4.2a colours the line and the markers with the palette colour of the trace index", () => {
    const t = one({ type: "scatter", x: "A", y: "B", mode: "lines+markers" }, 1);
    expect((t.line as { color?: string }).color).toBe(PALETTE[1]);
    expect((t.marker as { color?: string }).color).toBe(PALETTE[1]);
  });

  it("4.2a wraps the palette around when the index passes its length", () => {
    const t = one({ type: "scatter", x: "A", y: "B" }, 4);
    expect((t.line as { color?: string }).color).toBe(PALETTE[1]);
  });

  it("4.2a prefers the colour of the trace over the palette", () => {
    const t = one({ type: "scatter", x: "A", y: "B", color: "#123456" }, 2);
    expect((t.line as { color?: string }).color).toBe("#123456");
    expect((t.marker as { color?: string }).color).toBe("#123456");
    expect(json(t)).not.toContain(PALETTE[2]);
  });

  it("4.2a sets the line width and the marker size when the trace has them", () => {
    const t = one({ type: "scatter", x: "A", y: "B", mode: "lines+markers", lineWidth: 3, markerSize: 9 });
    expect((t.line as { width?: number }).width).toBe(3);
    expect((t.marker as { size?: number }).size).toBe(9);
  });

  it("4.2a leaves the line width and the marker size out when the trace has none", () => {
    const t = one({ type: "scatter", x: "A", y: "B" });
    expect(t.line).toEqual({ color: PALETTE[0] });
    expect(t.marker).toEqual({ color: PALETTE[0] });
  });
});

describe("traceData bar", () => {
  it("4.2a maps a vertical bar trace to x and y columns with the palette colour", () => {
    const t = one({ type: "bar", x: "A", y: "B" });
    expect(t.type).toBe("bar");
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.marker).toEqual({ color: PALETTE[0] });
    expect(t.orientation).toBeUndefined();
  });

  it("4.2a maps a vertical bar trace with orientation v without swapping the columns", () => {
    const t = one({ type: "bar", x: "A", y: "B", orientation: "v" });
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
  });

  it("4.2a maps a horizontal bar trace to orientation h with x from the Y column and y from the X column", () => {
    const t = one({ type: "bar", x: "A", y: "B", orientation: "h" });
    expect(t.type).toBe("bar");
    expect(t.orientation).toBe("h");
    expect(t.x).toEqual([10, 20, 30]);
    expect(t.y).toEqual([1, 2, 3]);
  });

  it("4.2a colours a bar trace with its own colour when set", () => {
    expect(one({ type: "bar", x: "A", y: "B", color: "#abcdef" }).marker).toEqual({ color: "#abcdef" });
  });
});

describe("traceData pie", () => {
  it("4.2a maps a pie trace to labels from X, values from Y, unsorted, with a palette colour per slice", () => {
    const t = one({ type: "pie", x: "E", y: "B" });
    expect(t.type).toBe("pie");
    expect(t.labels).toEqual(["a", "b", "c"]);
    expect(t.values).toEqual([10, 20, 30]);
    expect(t.sort).toBe(false);
    expect((t.marker as { colors?: string[] }).colors).toEqual([PALETTE[0], PALETTE[1], PALETTE[2]]);
  });

  it("4.2a wraps the palette for pie slices beyond its length", () => {
    const table: ChartTable = { cols: [{ name: "k", values: ["a", "b", "c", "d"] }, { name: "n", values: [1, 2, 3, 4] }] };
    const t = one({ type: "pie", x: "A", y: "B" }, 0, table);
    expect((t.marker as { colors?: string[] }).colors).toEqual([PALETTE[0], PALETTE[1], PALETTE[2], PALETTE[0]]);
  });

  it("4.2a sets the donut hole when the trace has one", () => {
    expect(one({ type: "pie", x: "E", y: "B", hole: 0.4 }).hole).toBe(0.4);
  });

  it("4.2a leaves the hole out when the trace has none", () => {
    expect(one({ type: "pie", x: "E", y: "B" }).hole).toBeUndefined();
  });
});

describe("traceData heatmap, contour and surface", () => {
  it.each(["heatmap", "contour", "surface"] as const)("4.2a maps a %s trace to a z matrix of rows by Z columns with x and y values", (type) => {
    const t = one({ type, x: "A", y: "B", z: ["C", "D"] });
    expect(t.type).toBe(type);
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.z).toEqual([[100, 400], [200, 500], [300, 600]]);
  });

  it.each(["heatmap", "contour", "surface"] as const)("4.2a swaps the z matrix of a %s trace when transpose is true", (type) => {
    const t = one({ type, x: "A", y: "B", z: ["C", "D"], transpose: true });
    expect(t.z).toEqual([[100, 200, 300], [400, 500, 600]]);
  });

  it("4.2a keeps the z matrix as rows by columns when transpose is false", () => {
    const t = one({ type: "heatmap", x: "A", y: "B", z: ["C", "D"], transpose: false });
    expect(t.z).toEqual([[100, 400], [200, 500], [300, 600]]);
  });

  it("4.2a numbers the rows 0..n-1 for y when the trace has no y column", () => {
    const t = one({ type: "heatmap", x: "A", z: ["C", "D"] });
    expect(t.y).toEqual([0, 1, 2]);
  });

  it("4.2a leaves x out when the trace has no x column", () => {
    const t = one({ type: "heatmap", y: "B", z: ["C", "D"] });
    expect("x" in t && t.x !== undefined).toBe(false);
  });

  it("4.2a takes the colourscale of the trace and shows the colour bar", () => {
    const t = one({ type: "heatmap", x: "A", y: "B", z: ["C", "D"], colorscale: "Hot" });
    expect(t.colorscale).toBe("Hot");
    expect(t.showscale).toBe(true);
  });

  it("4.2a shows the colour bar of a surface and a contour", () => {
    expect(one({ type: "surface", x: "A", y: "B", z: ["C", "D"] }).showscale).toBe(true);
    expect(one({ type: "contour", x: "A", y: "B", z: ["C", "D"] }).showscale).toBe(true);
  });
});

describe("traceData scatter3d and mesh3d", () => {
  it("4.2a maps a scatter3d trace to x, y and the first Z column, with mode markers by default", () => {
    const t = one({ type: "scatter3d", x: "A", y: "B", z: ["C", "D"] });
    expect(t.type).toBe("scatter3d");
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.z).toEqual([100, 200, 300]);
    expect(t.mode).toBe("markers");
    expect((t.marker as { color?: string }).color).toBe(PALETTE[0]);
    expect((t.line as { color?: string }).color).toBe(PALETTE[0]);
  });

  it("4.2a keeps the mode of a scatter3d trace and sets its line width and marker size", () => {
    const t = one({ type: "scatter3d", x: "A", y: "B", z: ["C"], mode: "lines+markers", lineWidth: 2, markerSize: 5 });
    expect(t.mode).toBe("lines+markers");
    expect((t.line as { width?: number }).width).toBe(2);
    expect((t.marker as { size?: number }).size).toBe(5);
  });

  it("4.2a maps a mesh3d trace to x, y, the first Z column and a colour", () => {
    const t = one({ type: "mesh3d", x: "A", y: "B", z: ["D"] }, 1);
    expect(t.type).toBe("mesh3d");
    expect(t.x).toEqual([1, 2, 3]);
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.z).toEqual([400, 500, 600]);
    expect(t.color).toBe(PALETTE[1]);
  });
});

describe("traceData histogram and box", () => {
  it("4.2a maps a histogram trace to x with the palette colour", () => {
    const t = one({ type: "histogram", x: "B" });
    expect(t.type).toBe("histogram");
    expect(t.x).toEqual([10, 20, 30]);
    expect(t.marker).toEqual({ color: PALETTE[0] });
  });

  it("4.2a maps a box trace to y and leaves x out when the trace has no x", () => {
    const t = one({ type: "box", y: "B" });
    expect(t.type).toBe("box");
    expect(t.y).toEqual([10, 20, 30]);
    expect(t.x).toBeUndefined();
    expect(t.marker).toEqual({ color: PALETTE[0] });
  });

  it("4.2a groups a box trace by its x column when it has one", () => {
    const t = one({ type: "box", x: "E", y: "B" });
    expect(t.x).toEqual(["a", "b", "c"]);
    expect(t.y).toEqual([10, 20, 30]);
  });
});

describe("traceData common fields", () => {
  const ALL: ChartTrace[] = [
    { type: "scatter", x: "A", y: "B" },
    { type: "bar", x: "A", y: "B" },
    { type: "pie", x: "E", y: "B" },
    { type: "heatmap", x: "A", y: "B", z: ["C", "D"] },
    { type: "contour", x: "A", y: "B", z: ["C", "D"] },
    { type: "surface", x: "A", y: "B", z: ["C", "D"] },
    { type: "scatter3d", x: "A", y: "B", z: ["C"] },
    { type: "mesh3d", x: "A", y: "B", z: ["C"] },
    { type: "histogram", x: "A" },
    { type: "box", y: "B" },
  ];

  it.each(ALL.map((t) => [t.type, t] as const))("4.2a sets name, opacity and showlegend on a %s trace when the model has them", (_type, trace) => {
    const t = one({ ...trace, name: "series", opacity: 0.5, showlegend: false });
    expect(t.name).toBe("series");
    expect(t.opacity).toBe(0.5);
    expect(t.showlegend).toBe(false);
  });

  it.each(ALL.map((t) => [t.type, t] as const))("4.2a leaves name, opacity and showlegend out of a %s trace when the model has none", (_type, trace) => {
    const t = one(trace);
    expect(t.name).toBeUndefined();
    expect(t.opacity).toBeUndefined();
    expect(t.showlegend).toBeUndefined();
  });

  it.each(ALL.map((t) => [t.type, t] as const))("4.2a keeps the type %s of the chart trace", (type, trace) => {
    expect(one(trace).type).toBe(type);
  });
});

describe("traceData text cells", () => {
  it("4.2c turns a text cell in a numeric y column of a scatter trace into a null gap", () => {
    expect(one({ type: "scatter", x: "A", y: "F" }).y).toEqual([1, null, 3]);
  });

  it("4.2c turns a text cell in a numeric x column of a scatter trace into a null gap", () => {
    expect(one({ type: "scatter", x: "F", y: "B" }).x).toEqual([1, null, 3]);
  });

  it("4.2c keeps a null cell as a null gap", () => {
    const table: ChartTable = { cols: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [1, null, 3] }] };
    expect(one({ type: "scatter", x: "A", y: "B" }, 0, table).y).toEqual([1, null, 3]);
  });

  it("4.2c turns text cells of the y column of a bar trace into null gaps", () => {
    expect(one({ type: "bar", x: "E", y: "F" }).y).toEqual([1, null, 3]);
  });

  it("4.2c keeps text in the x column of a bar trace", () => {
    expect(one({ type: "bar", x: "E", y: "B" }).x).toEqual(["a", "b", "c"]);
  });

  it("4.2c keeps text in the x column of a box trace", () => {
    expect(one({ type: "box", x: "E", y: "F" }).x).toEqual(["a", "b", "c"]);
  });

  it("4.2c turns text cells of the y column of a box trace into null gaps", () => {
    expect(one({ type: "box", y: "F" }).y).toEqual([1, null, 3]);
  });

  it("4.2c keeps text as the labels of a pie trace and turns text values into null gaps", () => {
    const t = one({ type: "pie", x: "E", y: "F" });
    expect(t.labels).toEqual(["a", "b", "c"]);
    expect(t.values).toEqual([1, null, 3]);
  });

  it("4.2c turns text cells of a z column into null gaps in the matrix", () => {
    const t = one({ type: "heatmap", x: "A", y: "B", z: ["C", "F"] });
    expect(t.z).toEqual([[100, 1], [200, null], [300, 3]]);
  });

  it("4.2c turns text in the x column of a heatmap into null gaps", () => {
    expect(one({ type: "heatmap", x: "E", y: "B", z: ["C"] }).x).toEqual([null, null, null]);
  });

  it("4.2c turns text cells of a histogram x column into null gaps", () => {
    expect(one({ type: "histogram", x: "F" }).x).toEqual([1, null, 3]);
  });

  it("4.2c turns text cells of the z column of a scatter3d trace into null gaps", () => {
    expect(one({ type: "scatter3d", x: "A", y: "B", z: ["F"] }).z).toEqual([1, null, 3]);
  });
});
