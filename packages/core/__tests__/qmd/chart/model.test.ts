// Tests the chart model reader (plan charts, decisions D3, D4, D13): readChartModel accepts a valid model of each kind, drops unknown keys, rounds the camera, and rejects what is not a valid v1 model; emptyChart makes a valid starting model.
import { emptyChart, readChartModel } from "../../../src/qmd/chart/model";
import type { ChartKind } from "../../../src/qmd/chart/model";

const ID = "0a1b2c3d";

const LAYOUT = { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true } };

const DATA_MODEL = {
  v: 1,
  id: ID,
  kind: "data",
  title: "Measurements",
  data: { cols: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [4, null, "n/a"] }] },
  traces: [{ type: "scatter", name: "line", x: "A", y: "B", mode: "lines", fill: "tozeroy", colorscale: "Viridis", color: "#ff0000", opacity: 0.5, showlegend: false }],
  fns: [],
  vars: [],
  layout: {
    xaxis: { title: "time", type: "linear", range: [0, 10], ticks: 2, grid: true },
    yaxis: { title: "value", type: "log", range: [1, 100], ticks: 10, grid: false },
    legend: { show: true, x: 0.5, y: 1, orientation: "h" },
    width: 640,
    height: 400,
  },
};

const FN2D_MODEL = {
  v: 1,
  id: "ffffffff",
  kind: "fn2d",
  traces: [],
  fns: [
    { kind: "y", rel: "=", expr: ["sin(a*x)"], domain: [-5, 5], steps: 400, color: "#00ff00", name: "f", hidden: false },
    { kind: "param", expr: ["cos(t)", "sin(t)"], domain: [0, 6.28], name: "circle" },
    { kind: "y", rel: "<=", expr: ["x^2"] },
  ],
  vars: [{ name: "a", value: 2, min: 0, max: 5, step: 0.5 }, { name: "b", value: 1 }],
  layout: LAYOUT,
};

const FN3D_MODEL = {
  v: 1,
  id: "00000000",
  kind: "fn3d",
  traces: [],
  fns: [{ kind: "surface", expr: ["x*y"], domain: [-1, 1], domain2: [-2, 2], steps: [30, 40] }],
  vars: [],
  layout: {
    xaxis: { type: "linear" },
    yaxis: { type: "linear" },
    zaxis: { title: "z", type: "linear", range: [-1, 1] },
    legend: { show: false },
    colorscale: "Viridis",
    camera: { eye: { x: 1.25, y: 1.25, z: 1.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } },
  },
};

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** A deep copy of the data model with `change` applied to it. */
function data(change: (m: Record<string, any>) => void): unknown {
  const m = clone(DATA_MODEL) as Record<string, any>;
  change(m);
  return m;
}

describe("1.2a readChartModel accepts a valid model of each kind", () => {
  it("1.2a reads a data chart with an inline table, trace, axes and legend", () => {
    expect(readChartModel(clone(DATA_MODEL))).toEqual(DATA_MODEL);
  });

  it("1.2a reads a fn2d chart with functions of several kinds and variables", () => {
    expect(readChartModel(clone(FN2D_MODEL))).toEqual(FN2D_MODEL);
  });

  it("1.2a reads a fn3d chart with a surface, a z axis and a camera", () => {
    expect(readChartModel(clone(FN3D_MODEL))).toEqual(FN3D_MODEL);
  });

  it("1.2a reads every trace type", () => {
    const types = ["scatter", "bar", "pie", "heatmap", "contour", "surface", "mesh3d", "scatter3d", "histogram", "box"];
    for (const type of types) {
      const model = readChartModel(data((m) => { m.traces = [{ type, x: "A", y: "B" }]; }));
      expect(model?.traces[0]?.type).toBe(type);
    }
  });

  it("1.2a reads a trace whose z holds column letters", () => {
    const model = readChartModel(data((m) => { m.traces = [{ type: "surface", z: ["A", "B", "C"] }]; }));
    expect(model?.traces[0]?.z).toEqual(["A", "B", "C"]);
  });

  it("1.2a reads spreadsheet column letters past Z", () => {
    const model = readChartModel(data((m) => { m.traces = [{ type: "scatter", x: "Z", y: "AA" }]; }));
    expect(model?.traces[0]).toMatchObject({ x: "Z", y: "AA" });
  });

  it("1.2a reads the stored variable value and the 3D camera (D13)", () => {
    const model = readChartModel(clone(FN2D_MODEL));
    expect(model?.vars[0]?.value).toBe(2);
    const model3 = readChartModel(clone(FN3D_MODEL));
    expect(model3?.layout.camera?.eye).toEqual({ x: 1.25, y: 1.25, z: 1.25 });
  });

  it("1.2a reads a model whose table is in a CSV file under assets/ (src)", () => {
    const model = readChartModel(data((m) => { delete m.data; m.src = `assets/${ID}.csv`; }));
    expect(model?.src).toBe(`assets/${ID}.csv`);
    expect(model?.data).toBeUndefined();
  });

  it("1.2a reads a model that went through JSON text", () => {
    expect(readChartModel(JSON.parse(JSON.stringify(DATA_MODEL)) as unknown)).toEqual(DATA_MODEL);
  });
});

describe("1.2a readChartModel drops unknown keys", () => {
  it("1.2a drops an unknown key at the top of the model", () => {
    expect(readChartModel(data((m) => { m.extra = 1; m.future = { a: 1 }; }))).toEqual(DATA_MODEL);
  });

  it("1.2a drops an unknown key in a trace", () => {
    expect(readChartModel(data((m) => { m.traces[0].marker = { size: 3 }; }))).toEqual(DATA_MODEL);
  });

  it("1.2a drops an unknown key in an axis and in the legend", () => {
    expect(readChartModel(data((m) => { m.layout.xaxis.tickangle = 45; m.layout.legend.bgcolor = "red"; }))).toEqual(DATA_MODEL);
  });

  it("1.2a drops an unknown key in the layout", () => {
    expect(readChartModel(data((m) => { m.layout.paper_bgcolor = "red"; }))).toEqual(DATA_MODEL);
  });

  it("1.2a drops an unknown key in a table column", () => {
    expect(readChartModel(data((m) => { m.data.cols[0].unit = "s"; }))).toEqual(DATA_MODEL);
  });

  it("1.2a drops an unknown key in a function, a variable and the camera", () => {
    const m2 = clone(FN2D_MODEL) as Record<string, any>;
    m2.fns[0].samples = [1, 2];
    m2.vars[0].unit = "s";
    expect(readChartModel(m2)).toEqual(FN2D_MODEL);
    const m3 = clone(FN3D_MODEL) as Record<string, any>;
    m3.layout.camera.projection = "orthographic";
    m3.layout.camera.eye.w = 1;
    expect(readChartModel(m3)).toEqual(FN3D_MODEL);
  });
});

describe("1.2a readChartModel rejects an invalid model", () => {
  it("1.2a rejects an unknown trace type", () => {
    expect(readChartModel(data((m) => { m.traces[0].type = "violin"; }))).toBeNull();
  });

  it.each(["1", "a", "A1", "", "AAA1", "x-axis"])("1.2a rejects the bad column reference %j in x", (col) => {
    expect(readChartModel(data((m) => { m.traces[0].x = col; }))).toBeNull();
  });

  it("1.2a rejects a bad column reference in y and in z", () => {
    expect(readChartModel(data((m) => { m.traces[0].y = "b"; }))).toBeNull();
    expect(readChartModel(data((m) => { m.traces[0] = { type: "surface", z: ["A", "3"] }; }))).toBeNull();
  });

  it.each([
    ["an absolute path", "/etc/passwd.csv"],
    ["a folder other than assets", "data/chart.csv"],
    ["a path with ..", "assets/../secret.csv"],
    ["a path that leaves assets with ..", "assets/../../secret.csv"],
    ["a path that starts with ..", "../assets/chart.csv"],
    ["a file that is not .csv", "assets/chart.txt"],
    ["a Windows drive path", "C:\\assets\\chart.csv"],
    ["a URL", "https://example.com/assets/chart.csv"],
  ])("1.2a rejects a src that is %s", (_name, src) => {
    expect(readChartModel(data((m) => { delete m.data; m.src = src; }))).toBeNull();
  });

  it("1.2a reads a src in a subfolder of assets/", () => {
    const model = readChartModel(data((m) => { delete m.data; m.src = "assets/sub/chart.csv"; }));
    expect(model?.src).toBe("assets/sub/chart.csv");
  });

  it("1.2a rejects an unknown version", () => {
    expect(readChartModel(data((m) => { m.v = 2; }))).toBeNull();
    expect(readChartModel(data((m) => { delete m.v; }))).toBeNull();
  });

  it("1.2a rejects an unknown kind", () => {
    expect(readChartModel(data((m) => { m.kind = "radar"; }))).toBeNull();
  });

  it.each(["", "0A1B2C3D", "0a1b2c3", "0a1b2c3d4", "0a1b2c3g"])("1.2a rejects the id %j (8 lowercase hex)", (id) => {
    expect(readChartModel(data((m) => { m.id = id; }))).toBeNull();
  });

  it("1.2a rejects input that is not an object", () => {
    for (const input of [null, undefined, 3, "text", true, [], [DATA_MODEL]]) {
      expect(readChartModel(input)).toBeNull();
    }
  });

  it("1.2a rejects a camera without eye", () => {
    const m = clone(FN3D_MODEL) as Record<string, any>;
    delete m.layout.camera.eye;
    expect(readChartModel(m)).toBeNull();
  });

  it("1.2a rejects a camera vector that is not finite or lacks a component", () => {
    const m = clone(FN3D_MODEL) as Record<string, any>;
    m.layout.camera.eye.z = "high";
    expect(readChartModel(m)).toBeNull();
    const n = clone(FN3D_MODEL) as Record<string, any>;
    delete n.layout.camera.up.y;
    expect(readChartModel(n)).toBeNull();
  });

  it("1.2a rejects a non-finite number in a camera", () => {
    const m = clone(FN3D_MODEL) as Record<string, any>;
    m.layout.camera.eye.x = Infinity;
    expect(readChartModel(m)).toBeNull();
    m.layout.camera.eye.x = NaN;
    expect(readChartModel(m)).toBeNull();
  });

  it("1.2a rejects a variable without a value", () => {
    const m = clone(FN2D_MODEL) as Record<string, any>;
    delete m.vars[0].value;
    expect(readChartModel(m)).toBeNull();
  });

  it("1.2a rejects a variable whose value is not finite", () => {
    const m = clone(FN2D_MODEL) as Record<string, any>;
    m.vars[0].value = NaN;
    expect(readChartModel(m)).toBeNull();
    m.vars[0].value = Infinity;
    expect(readChartModel(m)).toBeNull();
  });
});

describe("1.2a readChartModel rounds the camera to 4 decimals (D13)", () => {
  it("1.2a rounds eye, center and up", () => {
    const m = clone(FN3D_MODEL) as Record<string, any>;
    m.layout.camera = {
      eye: { x: 1.23454, y: -1.23456, z: 2 },
      center: { x: 0.00004, y: 0.1, z: 0 },
      up: { x: 0, y: 0, z: 0.99996 },
    };
    const camera = readChartModel(m)?.layout.camera;
    expect(camera?.eye.x).toBeCloseTo(1.2345, 10);
    expect(camera?.eye.y).toBeCloseTo(-1.2346, 10);
    expect(camera?.eye.z).toBe(2);
    expect(camera?.center?.x).toBe(0);
    expect(camera?.center?.y).toBe(0.1);
    expect(camera?.up?.z).toBe(1);
  });

  it("1.2a reads a camera with only eye", () => {
    const m = clone(FN3D_MODEL) as Record<string, any>;
    m.layout.camera = { eye: { x: 1, y: 2, z: 3 } };
    const camera = readChartModel(m)?.layout.camera;
    expect(camera?.eye).toEqual({ x: 1, y: 2, z: 3 });
    expect(camera?.center).toBeUndefined();
    expect(camera?.up).toBeUndefined();
  });
});

describe("1.2a emptyChart", () => {
  it.each<ChartKind>(["data", "fn2d", "fn3d"])("1.2a makes a valid empty %s chart that readChartModel keeps", (kind) => {
    const chart = emptyChart(kind, ID);
    expect(chart.v).toBe(1);
    expect(chart.id).toBe(ID);
    expect(chart.kind).toBe(kind);
    expect(Array.isArray(chart.traces)).toBe(true);
    expect(Array.isArray(chart.fns)).toBe(true);
    expect(Array.isArray(chart.vars)).toBe(true);
    expect(readChartModel(clone(chart))).toEqual(chart);
  });

  it("1.2a makes a new object on every call", () => {
    const a = emptyChart("data", ID);
    const b = emptyChart("data", ID);
    expect(a).not.toBe(b);
    expect(a.traces).not.toBe(b.traces);
  });
});
