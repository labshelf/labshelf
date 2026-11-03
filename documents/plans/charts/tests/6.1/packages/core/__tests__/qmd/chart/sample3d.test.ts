/**
 * Tests fnTraces3d and the fn3d branch of chartFigure (plan charts, spec 6.1, D8): z = f(x,y) on a grid into a surface
 * trace, parametric surfaces into a surface with three matrices, 3D curves into a scatter3d line, steps clamped to
 * [2, 200], null holes, the colourscale, the scene with zaxis and camera, and the error of a bad expression
 * (acceptance 6.1a, 6.1b, 6.1c, 6.1d).
 */
import { fnTraces3d } from "../../../src/qmd/chart/sample3d";
import { chartFigure } from "../../../src/qmd/chart/figure";
import type { ChartFn, ChartModel, ChartVar } from "../../../src/qmd/chart/model";

type Matrix = (number | null)[][];
type Trace = {
  type?: string;
  mode?: string;
  x: unknown;
  y: unknown;
  z: unknown;
  colorscale?: unknown;
  showscale?: unknown;
  name?: unknown;
  line?: { color?: unknown };
  [key: string]: unknown;
};

const SCALE = "Viridis";
const NONE: readonly ChartVar[] = [];
const TWO_PI = 2 * Math.PI;

function run(fn: ChartFn, vars: readonly ChartVar[] = NONE, scale = SCALE): { traces: Trace[]; error: ReturnType<typeof fnTraces3d>["error"] } {
  const { traces, error } = fnTraces3d(fn, vars, scale);
  return { traces: traces as Trace[], error };
}

const only = (traces: Trace[]): Trace => {
  expect(traces).toHaveLength(1);
  return traces[0] as Trace;
};

const SURFACE_FN: ChartFn = { kind: "surface", expr: ["x + y + cos(x) + sin(y)"], domain: [-10, 10], domain2: [-10, 10], steps: 30 };
const SPHERE: ChartFn = { kind: "param3d", expr: ["cos(u)*sin(v)", "sin(u)*sin(v)", "cos(v)"], domain: [0, TWO_PI], domain2: [0, Math.PI], steps: 20 };
const HELIX: ChartFn = { kind: "curve3d", expr: ["cos(t)", "sin(t)", "t/4"], domain: [0, 4 * Math.PI], steps: 60 };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const shapeOf = (m: unknown): [number, number[]] => {
  const rows = m as unknown[][];
  return [rows.length, rows.map((r) => r.length)];
};
const flat = (m: unknown): unknown[] => (m as unknown[][]).flat();

describe("6.1a surface z = f(x,y)", () => {
  it("6.1a gives one surface trace and no error", () => {
    const { traces, error } = run(SURFACE_FN);
    expect(error).toBeNull();
    expect(only(traces).type).toBe("surface");
  });

  it("6.1a gives x and y vectors of 30 values for steps 30", () => {
    const t = only(run(SURFACE_FN).traces);
    expect(t.x as unknown[]).toHaveLength(30);
    expect(t.y as unknown[]).toHaveLength(30);
    expect((t.x as unknown[]).every(isNum)).toBe(true);
    expect((t.y as unknown[]).every(isNum)).toBe(true);
  });

  it("6.1a gives a 30x30 z matrix for steps 30", () => {
    const t = only(run(SURFACE_FN).traces);
    const [rows, widths] = shapeOf(t.z);
    expect(rows).toBe(30);
    expect(widths.every((w) => w === 30)).toBe(true);
  });

  it("6.1a keeps the x and y vectors inside the domain and increasing", () => {
    const t = only(run(SURFACE_FN).traces);
    for (const axis of [t.x as number[], t.y as number[]]) {
      for (const v of axis) {
        expect(v).toBeGreaterThanOrEqual(-10 - 1e-9);
        expect(v).toBeLessThanOrEqual(10 + 1e-9);
      }
      for (let i = 1; i < axis.length; i++) { expect(axis[i]!).toBeGreaterThan(axis[i - 1]!); }
    }
  });

  it("6.1a computes z[j][i] = f(x[i], y[j])", () => {
    const t = only(run(SURFACE_FN).traces);
    const x = t.x as number[];
    const y = t.y as number[];
    const z = t.z as Matrix;
    for (const [j, i] of [[0, 0], [3, 17], [29, 5], [12, 12], [29, 29]] as [number, number][]) {
      const xi = x[i]!;
      const yj = y[j]!;
      expect(z[j]![i]).toBeCloseTo(xi + yj + Math.cos(xi) + Math.sin(yj), 6);
    }
  });

  it("6.1a carries the colourscale given, showscale false", () => {
    const t = only(run(SURFACE_FN, NONE, "Hot").traces);
    expect(t.colorscale).toBe("Hot");
    expect(t.showscale).toBe(false);
  });

  it("6.1a names the trace after fn.name when set", () => {
    expect(only(run({ ...SURFACE_FN, name: "wave" }).traces).name).toBe("wave");
  });

  it("6.1a uses 30 steps per axis and a default domain of [-10, 10] when none is given", () => {
    const t = only(run({ kind: "surface", expr: ["x*y"] }).traces);
    expect(t.x as unknown[]).toHaveLength(30);
    expect(t.y as unknown[]).toHaveLength(30);
    for (const v of [...(t.x as number[]), ...(t.y as number[])]) {
      expect(v).toBeGreaterThanOrEqual(-10 - 1e-9);
      expect(v).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(Math.max(...(t.x as number[])) - Math.min(...(t.x as number[]))).toBeGreaterThan(15);
    expect(Math.max(...(t.y as number[])) - Math.min(...(t.y as number[]))).toBeGreaterThan(15);
  });

  it("6.1a applies a steps pair [n, m] to x and y: n x values, m y values, m rows of n", () => {
    const t = only(run({ ...SURFACE_FN, steps: [5, 7] }).traces);
    expect(t.x as unknown[]).toHaveLength(5);
    expect(t.y as unknown[]).toHaveLength(7);
    const [rows, widths] = shapeOf(t.z);
    expect(rows).toBe(7);
    expect(widths.every((w) => w === 5)).toBe(true);
  });

  it("6.1a takes x from domain and y from domain2", () => {
    const t = only(run({ kind: "surface", expr: ["x + y"], domain: [0, 1], domain2: [100, 200], steps: 5 }).traces);
    for (const v of t.x as number[]) { expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
    for (const v of t.y as number[]) { expect(v).toBeGreaterThanOrEqual(100 - 1e-9); expect(v).toBeLessThanOrEqual(200 + 1e-9); }
  });

  it("6.1a evaluates the chart's variables", () => {
    const t = only(run({ kind: "surface", expr: ["a*x + y"], domain: [0, 4], domain2: [0, 4], steps: 5 }, [{ name: "a", value: 2 }]).traces);
    const x = t.x as number[];
    const y = t.y as number[];
    expect((t.z as Matrix)[2]![3]).toBeCloseTo(2 * x[3]! + y[2]!, 6);
  });
});

describe("6.1b parametric surfaces and 3D curves", () => {
  it("6.1b gives a sphere as one surface trace with no error", () => {
    const { traces, error } = run(SPHERE);
    expect(error).toBeNull();
    expect(only(traces).type).toBe("surface");
  });

  it("6.1b gives the sphere three matrices of the same shape", () => {
    const t = only(run(SPHERE).traces);
    const shape = shapeOf(t.x);
    expect(shape[0]).toBeGreaterThan(1);
    expect(shapeOf(t.y)).toEqual(shape);
    expect(shapeOf(t.z)).toEqual(shape);
    expect(shape[1].every((w) => w === shape[1][0])).toBe(true);
  });

  it("6.1b sizes a sphere with steps 20 as 20x20 matrices", () => {
    const t = only(run(SPHERE).traces);
    expect(shapeOf(t.x)).toEqual([20, Array(20).fill(20)]);
  });

  it("6.1b puts every sphere point on the unit sphere", () => {
    const t = only(run(SPHERE).traces);
    const xs = flat(t.x);
    const ys = flat(t.y);
    const zs = flat(t.z);
    expect(xs.length).toBe(400);
    for (let k = 0; k < xs.length; k++) {
      const r2 = (xs[k] as number) ** 2 + (ys[k] as number) ** 2 + (zs[k] as number) ** 2;
      expect(r2).toBeCloseTo(1, 6);
    }
  });

  it("6.1b carries the colourscale, showscale false and the name on a parametric surface", () => {
    const t = only(run({ ...SPHERE, name: "ball" }, NONE, "Jet").traces);
    expect(t.colorscale).toBe("Jet");
    expect(t.showscale).toBe(false);
    expect(t.name).toBe("ball");
  });

  it("6.1b takes u from domain and v from domain2 for a parametric surface", () => {
    const t = only(run({ kind: "param3d", expr: ["u", "v", "0"], domain: [0, 1], domain2: [10, 20], steps: 4 }).traces);
    for (const v of flat(t.x) as number[]) { expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(1 + 1e-9); }
    for (const v of flat(t.y) as number[]) { expect(v).toBeGreaterThanOrEqual(10 - 1e-9); expect(v).toBeLessThanOrEqual(20 + 1e-9); }
  });

  it("6.1b gives a helix as one scatter3d trace in mode lines with no error", () => {
    const { traces, error } = run(HELIX);
    expect(error).toBeNull();
    const t = only(traces);
    expect(t.type).toBe("scatter3d");
    expect(t.mode).toBe("lines");
  });

  it("6.1b gives the helix x, y and z arrays of equal length on the unit cylinder", () => {
    const t = only(run(HELIX).traces);
    const x = t.x as number[];
    const y = t.y as number[];
    const z = t.z as number[];
    expect(x.length).toBe(60);
    expect(y).toHaveLength(60);
    expect(z).toHaveLength(60);
    for (let k = 0; k < x.length; k++) { expect(x[k]! ** 2 + y[k]! ** 2).toBeCloseTo(1, 6); }
  });

  it("6.1b raises the helix z along the parameter", () => {
    const z = only(run(HELIX).traces).z as number[];
    for (let k = 1; k < z.length; k++) { expect(z[k]!).toBeGreaterThan(z[k - 1]!); }
  });

  it("6.1b defaults a curve to 30 points inside [0, 2π]", () => {
    const t = only(run({ kind: "curve3d", expr: ["t", "0", "0"] }).traces);
    const x = t.x as number[];
    expect(x).toHaveLength(30);
    for (const v of x) { expect(v).toBeGreaterThanOrEqual(-1e-9); expect(v).toBeLessThanOrEqual(TWO_PI + 1e-9); }
    expect(Math.max(...x)).toBeGreaterThan(TWO_PI * 0.9);
  });

  it("6.1b sets line.color of a curve to fn.color when set", () => {
    expect(only(run({ ...HELIX, color: "#ff0000" }).traces).line?.color).toBe("#ff0000");
  });

  it("6.1b names a curve trace after fn.name when set", () => {
    expect(only(run({ ...HELIX, name: "spiral" }).traces).name).toBe("spiral");
  });

  it("6.1b uses the chart's variables in a curve", () => {
    const t = only(run({ kind: "curve3d", expr: ["r*cos(t)", "r*sin(t)", "t"], steps: 10 }, [{ name: "r", value: 3 }]).traces);
    const x = t.x as number[];
    const y = t.y as number[];
    for (let k = 0; k < x.length; k++) { expect(x[k]! ** 2 + y[k]! ** 2).toBeCloseTo(9, 6); }
  });

  it("6.1b gives no traces and no error for a kind that is not 3D", () => {
    expect(run({ kind: "y", rel: "=", expr: ["x"] })).toEqual({ traces: [], error: null });
    expect(run({ kind: "polar", expr: ["1"] })).toEqual({ traces: [], error: null });
  });
});

describe("6.1c steps and holes", () => {
  it("6.1c clamps steps 500 to 200 on a surface", () => {
    const t = only(run({ ...SURFACE_FN, steps: 500 }).traces);
    expect(t.x as unknown[]).toHaveLength(200);
    expect(t.y as unknown[]).toHaveLength(200);
    expect(shapeOf(t.z)).toEqual([200, Array(200).fill(200)]);
  });

  it("6.1c clamps each of a steps pair separately", () => {
    const t = only(run({ ...SURFACE_FN, steps: [500, 1] }).traces);
    expect(t.x as unknown[]).toHaveLength(200);
    expect(t.y as unknown[]).toHaveLength(2);
  });

  it("6.1c clamps steps 500 to 200 on a curve", () => {
    expect(only(run({ ...HELIX, steps: 500 }).traces).x as unknown[]).toHaveLength(200);
  });

  it("6.1c clamps steps 500 to 200 on a parametric surface", () => {
    const t = only(run({ ...SPHERE, steps: 500 }).traces);
    expect(shapeOf(t.x)).toEqual([200, Array(200).fill(200)]);
  });

  it("6.1c raises steps below 2 to 2", () => {
    const t = only(run({ ...SURFACE_FN, steps: 0 }).traces);
    expect(t.x as unknown[]).toHaveLength(2);
    expect(t.y as unknown[]).toHaveLength(2);
  });

  it("6.1c rounds fractional steps", () => {
    const t = only(run({ ...SURFACE_FN, steps: 10.4 }).traces);
    expect(t.x as unknown[]).toHaveLength(10);
    expect(t.y as unknown[]).toHaveLength(10);
  });

  it("6.1c turns sqrt of a negative into null holes in a surface", () => {
    const { traces, error } = run({ kind: "surface", expr: ["sqrt(x)"], domain: [-4, 4], domain2: [0, 1], steps: 9 });
    expect(error).toBeNull();
    const t = only(traces);
    const x = t.x as number[];
    const z = t.z as Matrix;
    let holes = 0;
    let values = 0;
    for (const row of z) {
      for (let i = 0; i < x.length; i++) {
        if (x[i]! < -1e-9) { expect(row[i]).toBeNull(); holes += 1; }
        else if (x[i]! > 1e-9) { expect(row[i]).toBeCloseTo(Math.sqrt(x[i]!), 6); values += 1; }
      }
    }
    expect(holes).toBeGreaterThan(0);
    expect(values).toBeGreaterThan(0);
  });

  it("6.1c leaves no NaN or Infinity in a surface", () => {
    const t = only(run({ kind: "surface", expr: ["1/x + sqrt(y)"], domain: [-2, 2], domain2: [-2, 2], steps: 11 }).traces);
    for (const v of flat(t.z)) { expect(v === null || isNum(v)).toBe(true); }
  });

  it("6.1c turns non-finite values of a parametric surface and a curve into null", () => {
    const surf = only(run({ kind: "param3d", expr: ["u", "v", "sqrt(u)"], domain: [-1, 1], domain2: [0, 1], steps: 6 }).traces);
    expect(flat(surf.z).some((v) => v === null)).toBe(true);
    for (const v of flat(surf.z)) { expect(v === null || isNum(v)).toBe(true); }
    const curve = only(run({ kind: "curve3d", expr: ["t", "t", "sqrt(t)"], domain: [-1, 1], steps: 6 }).traces);
    const z = curve.z as unknown[];
    expect(z.some((v) => v === null)).toBe(true);
    for (const v of z) { expect(v === null || isNum(v)).toBe(true); }
  });
});

const THEME = { fg: "#112233", muted: "#778899", grid: "#445566", font: "Test Sans", palette: ["#aa0000", "#00aa00", "#0000aa"] as const };
const CAMERA = { eye: { x: 1.5, y: 1.5, z: 1 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

function fnModel(fns: ChartFn[], layout: Partial<ChartModel["layout"]> = {}, vars: ChartVar[] = []): ChartModel {
  return {
    v: 1,
    id: "a1b2c3d4",
    kind: "fn3d",
    traces: [],
    fns,
    vars,
    layout: { xaxis: { type: "linear" }, yaxis: { type: "linear" }, legend: { show: true }, ...layout },
  };
}

type Scene = { zaxis: { type?: string; range?: unknown; nticks?: unknown; title?: unknown }; camera?: unknown };
const sceneOf = (model: ChartModel): Scene => (chartFigure(model, null, THEME).layout as { scene: Scene }).scene;

describe("6.1d chartFigure of an fn3d model", () => {
  it("6.1d gives one surface trace for one surface fn", () => {
    const figure = chartFigure(fnModel([SURFACE_FN]), null, THEME);
    expect(figure.data).toHaveLength(1);
    expect(figure.data[0]!.type).toBe("surface");
    expect(shapeOf(figure.data[0]!.z)).toEqual([30, Array(30).fill(30)]);
  });

  it("6.1d colours the surface with the layout colourscale", () => {
    const figure = chartFigure(fnModel([SURFACE_FN], { colorscale: "Hot" }), null, THEME);
    expect(figure.data[0]!.colorscale).toBe("Hot");
  });

  it("6.1d falls back to Viridis when the layout has no colourscale", () => {
    const figure = chartFigure(fnModel([SURFACE_FN]), null, THEME);
    expect(figure.data[0]!.colorscale).toBe("Viridis");
  });

  it("6.1d gives a layout.scene with the zaxis of the layout", () => {
    const scene = sceneOf(fnModel([SURFACE_FN], { zaxis: { type: "log", title: "Height", range: [1, 100], ticks: 4 } }));
    expect(scene).toBeDefined();
    expect(scene.zaxis.type).toBe("log");
    expect(JSON.stringify(scene.zaxis.title)).toContain("Height");
    expect(scene.zaxis.range).toEqual([0, 2]);
    expect(scene.zaxis.nticks).toBe(4);
  });

  it("6.1d puts the stored camera in the scene", () => {
    expect(sceneOf(fnModel([SURFACE_FN], { camera: CAMERA })).camera).toEqual(CAMERA);
  });

  it("6.1d draws a parametric surface and a curve of an fn3d model", () => {
    const figure = chartFigure(fnModel([SPHERE, HELIX]), null, THEME);
    expect(figure.data.map((t) => t.type)).toEqual(["surface", "scatter3d"]);
  });

  it("6.1d skips hidden fns", () => {
    const figure = chartFigure(fnModel([{ ...SURFACE_FN, hidden: true }, HELIX]), null, THEME);
    expect(figure.data.map((t) => t.type)).toEqual(["scatter3d"]);
  });

  it("6.1d gives the chart's variables to the fns of the figure", () => {
    const fn: ChartFn = { kind: "surface", expr: ["a*x"], domain: [0, 2], domain2: [0, 1], steps: 3 };
    const t = chartFigure(fnModel([fn], {}, [{ name: "a", value: 5 }]), null, THEME).data[0] as Trace;
    const x = t.x as number[];
    expect((t.z as Matrix)[1]![2]).toBeCloseTo(5 * x[2]!, 6);
  });

  it("6.1d gives the message, position and part of a bad surface expression", () => {
    const { error } = run({ kind: "surface", expr: ["x +"] });
    expect(error).not.toBeNull();
    expect(typeof error!.message).toBe("string");
    expect(error!.message.length).toBeGreaterThan(0);
    expect(Number.isInteger(error!.at)).toBe(true);
    expect(error!.at).toBeGreaterThanOrEqual(0);
    expect(error!.part).toBe(0);
  });

  it("6.1d names the failing part of a parametric surface", () => {
    const { traces, error } = run({ kind: "param3d", expr: ["cos(u)", "sin(u) *", "v"] });
    expect(error).not.toBeNull();
    expect(error!.part).toBe(1);
    expect(traces).toEqual([]);
  });

  it("6.1d names the failing part of a curve", () => {
    const { error } = run({ kind: "curve3d", expr: ["cos(t)", "sin(t)", "t +"] });
    expect(error).not.toBeNull();
    expect(error!.part).toBe(2);
  });

  it("6.1d reports a position inside the failing text", () => {
    const text = "x + * y";
    const { error } = run({ kind: "surface", expr: [text] });
    expect(error).not.toBeNull();
    expect(error!.at).toBeLessThanOrEqual(text.length);
  });
});
