// Tests the labshelf-plot v1 spec module: readPlotSpec validates and normalises (rounding, line decimation, mesh cap), formatPlotSpec writes one line under the 256 KB cap, parsePlotSpec is JSON.parse then readPlotSpec.
// Written as if the file sat at packages/core/__tests__/qmd/plot/plotSpec.test.ts (it mirrors src/qmd/plot/); relative imports are resolved from there.
import {
  formatPlotSpec, parsePlotSpec, readPlotSpec,
  type PlotLineTrace, type PlotMeshTrace, type PlotSpec, type PlotSurfaceTrace,
} from "../../../src/qmd/plot/plotSpec";

// The decided limits, as literals: the seam stubs generate only functions and types.
const PLOT_LINE_POINTS = 2000;
const PLOT_MESH_TRIANGLES = 20000;
const PLOT_SPEC_BYTES = 262144;

type Json = Record<string, unknown>;

const line2d = (extra: Json = {}): Json => ({ type: "line", x: [1, 2, 3], y: [4, 5, 6], ...extra });
const spec2d = (over: Json = {}, trace: Json = line2d()): Json => ({
  v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [trace], ...over,
});
const surface = (rows: number, cols: number): Json => ({
  type: "surface",
  x: Array.from({ length: cols }, (_, i) => i),
  y: Array.from({ length: rows }, (_, i) => i),
  z: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1)),
});
const mesh = (faces: number): Json => ({
  type: "mesh",
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  faces: Array.from({ length: faces }, () => [0, 1, 2]),
});
const spec3d = (trace: Json, over: Json = {}): Json => ({
  v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces: [trace], ...over,
});

const must = (value: unknown): PlotSpec => {
  const spec = readPlotSpec(value);
  expect(spec).not.toBeNull();
  return spec as PlotSpec;
};
const lineOf = (spec: PlotSpec, i = 0): PlotLineTrace => spec.traces[i] as PlotLineTrace;
const round4 = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(4)));

describe("1.2a valid specs read back", () => {
  it("1.2a reads a 2D line spec", () => {
    const spec = must(spec2d({ title: "T", axes: { x: { label: "t", log: false, range: [0, 10] }, y: { label: "v" } } }, line2d({ name: "a", color: "#ff0000" })));
    expect(spec.v).toBe(1);
    expect(spec.dim).toBe(2);
    expect(spec.title).toBe("T");
    expect(spec.axes.x).toEqual({ label: "t", log: false, range: [0, 10] });
    expect(spec.axes.y).toEqual({ label: "v" });
    expect(spec.traces).toEqual([{ type: "line", name: "a", color: "#ff0000", x: [1, 2, 3], y: [4, 5, 6] }]);
  });

  it("1.2a reads a 2D points spec", () => {
    const spec = must(spec2d({}, line2d({ type: "points" })));
    expect(lineOf(spec).type).toBe("points");
    expect(lineOf(spec).x).toEqual([1, 2, 3]);
  });

  it("1.2a keeps null gaps in a line", () => {
    const spec = must(spec2d({}, line2d({ y: [4, null, 6] })));
    expect(lineOf(spec).y).toEqual([4, null, 6]);
  });

  it("1.2a reads a 3D line with z", () => {
    const spec = must(spec3d(line2d({ z: [7, 8, 9] })));
    expect(spec.dim).toBe(3);
    expect(lineOf(spec).z).toEqual([7, 8, 9]);
  });

  it("1.2a reads a 3D surface", () => {
    const spec = must(spec3d({ type: "surface", x: [0, 1, 2], y: [0, 1], z: [[1, 2, null], [4, 5, 6]] }));
    const trace = spec.traces[0] as PlotSurfaceTrace;
    expect(trace.type).toBe("surface");
    expect(trace.x).toEqual([0, 1, 2]);
    expect(trace.y).toEqual([0, 1]);
    expect(trace.z).toEqual([[1, 2, null], [4, 5, 6]]);
  });

  it("1.2a reads a 3D mesh", () => {
    const spec = must(spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], faces: [[0, 1, 2], [0, 2, 3]] }));
    const trace = spec.traces[0] as PlotMeshTrace;
    expect(trace.vertices).toHaveLength(4);
    expect(trace.faces).toEqual([[0, 1, 2], [0, 2, 3]]);
  });

  it("1.2a reads several traces in order", () => {
    const spec = must({ ...spec2d(), traces: [line2d({ name: "a" }), line2d({ type: "points", name: "b" })] });
    expect(spec.traces.map((t) => t.name)).toEqual(["a", "b"]);
  });

  it("1.2a drops z from a 2D line", () => {
    const spec = must(spec2d({}, line2d({ z: [7, 8, 9] })));
    expect(lineOf(spec).z).toBeUndefined();
  });

  it("1.2a drops unknown keys everywhere", () => {
    const spec = must({
      v: 1, dim: 2, extra: 1,
      axes: { x: { junk: 1, label: "x" }, y: {}, w: {} },
      traces: [{ type: "line", x: [1], y: [2], bogus: true }],
    }) as unknown as Json;
    expect(spec.extra).toBeUndefined();
    const axes = spec.axes as Json;
    expect(axes.w).toBeUndefined();
    expect((axes.x as Json).junk).toBeUndefined();
    expect((axes.x as Json).label).toBe("x");
    expect(((spec.traces as Json[])[0]!).bogus).toBeUndefined();
  });
});

describe("1.2a malformed specs return null", () => {
  const cases: Array<[string, unknown]> = [
    ["v not 1", spec2d({ v: 2 })],
    ["v missing", (() => { const s = spec2d(); delete s.v; return s; })()],
    ["v as string", spec2d({ v: "1" })],
    ["dim 4", spec2d({ dim: 4 })],
    ["dim as string", spec2d({ dim: "2" })],
    ["dim missing", (() => { const s = spec2d(); delete s.dim; return s; })()],
    ["axes null", spec2d({ axes: null })],
    ["axes a string", spec2d({ axes: "xy" })],
    ["axes missing", (() => { const s = spec2d(); delete s.axes; return s; })()],
    ["axes.x missing", spec2d({ axes: { y: {} } })],
    ["axes.y missing", spec2d({ axes: { x: {} } })],
    ["axes.x not an object", spec2d({ axes: { x: 5, y: {} } })],
    ["axes.y not an object", spec2d({ axes: { x: {}, y: "y" } })],
    ["traces missing", (() => { const s = spec2d(); delete s.traces; return s; })()],
    ["traces empty", spec2d({ traces: [] })],
    ["traces not an array", spec2d({ traces: line2d() })],
    ["unknown trace type", spec2d({}, line2d({ type: "bar" }))],
    ["trace missing type", spec2d({}, { x: [1], y: [2] })],
    ["one bad trace among good", spec2d({ traces: [line2d(), line2d({ type: "bar" })] })],
    ["trace not an object", spec2d({ traces: [5] })],
    ["x and y of different length", spec2d({}, line2d({ y: [1, 2] }))],
    ["empty x and y", spec2d({}, line2d({ x: [], y: [] }))],
    ["x missing", spec2d({}, { type: "line", y: [1, 2, 3] })],
    ["string value in y", spec2d({}, line2d({ y: [1, "2", 3] }))],
    ["numeric string in x", spec2d({}, line2d({ x: ["1", 2, 3] }))],
    ["boolean value", spec2d({}, line2d({ y: [1, true, 3] }))],
    ["NaN value", spec2d({}, line2d({ y: [1, NaN, 3] }))],
    ["Infinity value", spec2d({}, line2d({ y: [1, Infinity, 3] }))],
    ["undefined value", spec2d({}, line2d({ y: [1, undefined, 3] }))],
    ["object value", spec2d({}, line2d({ y: [1, {}, 3] }))],
    ["surface when dim is 2", spec2d({}, surface(3, 3))],
    ["mesh when dim is 2", spec2d({}, mesh(1))],
    ["3D line without z", spec3d(line2d())],
    ["3D line with z of another length", spec3d(line2d({ z: [1, 2] }))],
    ["3D line with a bad z value", spec3d(line2d({ z: [1, "a", 3] }))],
    ["surface z with too few rows", spec3d({ type: "surface", x: [0, 1], y: [0, 1], z: [[1, 2]] })],
    ["surface z with a short row", spec3d({ type: "surface", x: [0, 1], y: [0, 1], z: [[1, 2], [3]] })],
    ["surface z with a long row", spec3d({ type: "surface", x: [0, 1], y: [0, 1], z: [[1, 2], [3, 4, 5]] })],
    ["surface x with a null", spec3d({ type: "surface", x: [0, null], y: [0, 1], z: [[1, 2], [3, 4]] })],
    ["surface y with a string", spec3d({ type: "surface", x: [0, 1], y: [0, "1"], z: [[1, 2], [3, 4]] })],
    ["surface z a flat array", spec3d({ type: "surface", x: [0, 1], y: [0, 1], z: [1, 2, 3, 4] })],
    ["surface z with a string", spec3d({ type: "surface", x: [0, 1], y: [0, 1], z: [[1, "2"], [3, 4]] })],
    ["mesh vertex with 2 numbers", spec3d({ type: "mesh", vertices: [[0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] })],
    ["mesh vertex with 4 numbers", spec3d({ type: "mesh", vertices: [[0, 0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] })],
    ["mesh vertex with a null", spec3d({ type: "mesh", vertices: [[0, 0, null], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] })],
    ["mesh vertex with NaN", spec3d({ type: "mesh", vertices: [[0, 0, NaN], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] })],
    ["mesh with no faces", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [] })],
    ["mesh face index equal to vertices.length", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 3]] })],
    ["mesh face with a negative index", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, -1]] })],
    ["mesh face with a fractional index", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 1.5]] })],
    ["mesh face with 2 indices", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1]] })],
    ["mesh face with 4 indices", spec3d({ type: "mesh", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2, 0]] })],
    ["mesh vertices not an array", spec3d({ type: "mesh", vertices: "abc", faces: [[0, 1, 2]] })],
  ];

  it.each(cases)("1.2a returns null for %s", (_name, input) => {
    expect(readPlotSpec(input)).toBeNull();
  });

  it.each<[string, unknown]>([
    ["null", null], ["undefined", undefined], ["a number", 5], ["a string", "spec"], ["an array", []], ["a boolean", true],
  ])("1.2a returns null for %s without throwing", (_name, input) => {
    expect(() => readPlotSpec(input)).not.toThrow();
    expect(readPlotSpec(input)).toBeNull();
  });

  it("1.2a never throws on a hostile value", () => {
    const hostile = { v: 1, dim: 2, axes: { x: {}, y: {} }, get traces(): unknown { throw new Error("boom"); } };
    expect(() => readPlotSpec(hostile)).not.toThrow();
  });

  it("1.2a parsePlotSpec returns null on a JSON parse error", () => {
    expect(parsePlotSpec("{not json")).toBeNull();
    expect(parsePlotSpec("")).toBeNull();
  });

  it("1.2a parsePlotSpec returns null for JSON that is not a spec", () => {
    expect(parsePlotSpec("null")).toBeNull();
    expect(parsePlotSpec("[]")).toBeNull();
    expect(parsePlotSpec(JSON.stringify(spec2d({ v: 2 })))).toBeNull();
  });

  it("1.2a parsePlotSpec reads a valid JSON spec like readPlotSpec", () => {
    const input = spec2d({ title: "T" });
    expect(parsePlotSpec(JSON.stringify(input))).toEqual(readPlotSpec(input));
    expect(parsePlotSpec(JSON.stringify(input))).not.toBeNull();
  });
});

describe("1.2a optional fields", () => {
  const axisOf = (axis: Json): Json => must(spec2d({ axes: { x: axis, y: {} } })).axes.x as unknown as Json;

  it("1.2a keeps a string title and drops a non-string one without voiding the spec", () => {
    expect(must(spec2d({ title: "Hello" })).title).toBe("Hello");
    expect(must(spec2d({ title: 5 })).title).toBeUndefined();
  });

  it("1.2a keeps a string trace name and drops a non-string one", () => {
    expect(lineOf(must(spec2d({}, line2d({ name: "n" })))).name).toBe("n");
    const dropped = must(spec2d({}, line2d({ name: 3 })));
    expect(lineOf(dropped).name).toBeUndefined();
    expect(lineOf(dropped).x).toEqual([1, 2, 3]);
  });

  it("1.2a keeps a string axis label and drops a non-string one", () => {
    expect(axisOf({ label: "t" }).label).toBe("t");
    expect(axisOf({ label: 4 }).label).toBeUndefined();
  });

  it("1.2a keeps a boolean log and drops a non-boolean one", () => {
    expect(axisOf({ log: true }).log).toBe(true);
    expect(axisOf({ log: false }).log).toBe(false);
    expect(axisOf({ log: "yes" }).log).toBeUndefined();
    expect(axisOf({ log: 1 }).log).toBeUndefined();
  });

  it("1.2a keeps a range of two finite numbers with first < second", () => {
    expect(axisOf({ range: [-1, 1] }).range).toEqual([-1, 1]);
  });

  it.each<[string, unknown]>([
    ["first greater than second", [5, 1]],
    ["first equal to second", [2, 2]],
    ["one number", [1]],
    ["three numbers", [1, 2, 3]],
    ["a NaN bound", [NaN, 2]],
    ["an Infinity bound", [0, Infinity]],
    ["a string bound", [0, "2"]],
    ["not an array", "0-2"],
  ])("1.2a drops a range with %s", (_name, range) => {
    expect(axisOf({ range }).range).toBeUndefined();
    expect(axisOf({ range }).label).toBeUndefined();
  });

  it.each(["#abc", "#ABC", "#aabbcc", "#AaBb09", "#aabbccdd", "#12345678"])("1.2a keeps color %s", (color) => {
    expect(lineOf(must(spec2d({}, line2d({ color })))).color).toBe(color);
  });

  it.each(["red", "#12", "#abcd", "#12345", "#1234567", "#123456789", "abc", "#ggg", "#abc ", " #abc", 5])(
    "1.2a drops invalid color %p without voiding the spec", (color) => {
      const spec = must(spec2d({}, line2d({ color })));
      expect(lineOf(spec).color).toBeUndefined();
      expect(lineOf(spec).y).toEqual([4, 5, 6]);
    });

  it("1.2a keeps axes.z for dim 3", () => {
    const spec = must(spec3d(line2d({ z: [1, 2, 3] }), { axes: { x: {}, y: {}, z: { label: "depth" } } }));
    expect(spec.axes.z).toEqual({ label: "depth" });
  });

  it("1.2a drops axes.z for dim 2", () => {
    const spec = must(spec2d({ axes: { x: {}, y: {}, z: { label: "depth" } } }));
    expect(spec.axes.z).toBeUndefined();
  });
});

describe("1.2b rounding", () => {
  it("1.2b rounds line values to 4 significant digits", () => {
    const spec = must(spec2d({}, line2d({ x: [1.234567, 123456, 0.000123456], y: [-9.87654, 3.14159265, 1e-7 * 1.23456] })));
    expect(lineOf(spec).x).toEqual([1.235, 123500, 0.0001235]);
    expect(lineOf(spec).y).toEqual([-9.877, 3.142, 1.235e-7]);
  });

  it("1.2b leaves values with 4 or fewer significant digits unchanged", () => {
    const spec = must(spec2d({}, line2d({ x: [1, 0.5, 1234], y: [-2.5, 100, 0.01234] })));
    expect(lineOf(spec).x).toEqual([1, 0.5, 1234]);
    expect(lineOf(spec).y).toEqual([-2.5, 100, 0.01234]);
  });

  it("1.2b rounds each value to Number(v.toPrecision(4))", () => {
    const values = [0.1 + 0.2, Math.PI, Math.E * 1000, 99999.5, 7 / 3, -1 / 3];
    const spec = must(spec2d({}, line2d({ x: values, y: values })));
    expect(lineOf(spec).y).toEqual(values.map((v) => Number(v.toPrecision(4))));
  });

  it("1.2b turns -0 into 0", () => {
    const spec = must(spec2d({}, line2d({ x: [-0, 1], y: [1, -0] })));
    expect(Object.is(lineOf(spec).x[0], 0)).toBe(true);
    expect(Object.is(lineOf(spec).y[1], 0)).toBe(true);
  });

  it("1.2b keeps null gaps as null while rounding", () => {
    const spec = must(spec2d({}, line2d({ y: [1.23456, null, 2.34567] })));
    expect(lineOf(spec).y).toEqual([1.235, null, 2.346]);
  });

  it("1.2b rounds z of a 3D line", () => {
    const spec = must(spec3d(line2d({ z: [1.23456, 2.34567, 3.45678] })));
    expect(lineOf(spec).z).toEqual([1.235, 2.346, 3.457]);
  });

  it("1.2b rounds axis range bounds", () => {
    const spec = must(spec2d({ axes: { x: { range: [0.123456, 98765] }, y: { range: [-1.23456, 1.23456] } } }));
    expect(spec.axes.x.range).toEqual([0.1235, 98770]);
    expect(spec.axes.y.range).toEqual([-1.235, 1.235]);
  });

  it("1.2b rounds surface x, y and z", () => {
    const spec = must(spec3d({ type: "surface", x: [0.123456, 1.23456], y: [2.34567, 3.45678], z: [[1.11111, null], [2.22222, 3.33333]] }));
    const trace = spec.traces[0] as PlotSurfaceTrace;
    expect(trace.x).toEqual([0.1235, 1.235]);
    expect(trace.y).toEqual([2.346, 3.457]);
    expect(trace.z).toEqual([[1.111, null], [2.222, 3.333]]);
  });

  it("1.2b rounds mesh vertices", () => {
    const spec = must(spec3d({ type: "mesh", vertices: [[0.123456, 1.23456, -0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] }));
    const trace = spec.traces[0] as PlotMeshTrace;
    expect(trace.vertices[0]![0]).toBe(0.1235);
    expect(trace.vertices[0]![1]).toBe(1.235);
    expect(Object.is(trace.vertices[0]![2], 0)).toBe(true);
  });

  it("1.2b does not round face indices", () => {
    const count = 12346;
    const vertices = Array.from({ length: count }, (_, i) => [i % 7, i % 5, i % 3]);
    const spec = must(spec3d({ type: "mesh", vertices, faces: [[0, 12345, 12344]] }));
    expect((spec.traces[0] as PlotMeshTrace).faces).toEqual([[0, 12345, 12344]]);
  });
});

describe("1.2b decimation", () => {
  const N = 100000;
  const yAt = (i: number): number => Math.round(Math.sin(i / 37) * 500 + Math.cos(i / 1013) * 400);
  const MIN_AT = 41234;
  const MAX_AT = 77777;
  const gapsAt = [7777, 23456, 50000, 66666, 91011];

  const bigLine = (type: "line" | "points" = "line", withZ = false): Json => {
    const x: number[] = [];
    const y: Array<number | null> = [];
    const z: Array<number | null> = [];
    for (let i = 0; i < N; i++) {
      x.push(i);
      let v: number | null = yAt(i);
      if (i === MIN_AT) v = -1000;
      if (i === MAX_AT) v = 1000;
      if (gapsAt.includes(i)) v = null;
      y.push(v);
      z.push(v === null ? null : v + 1);
    }
    return withZ ? { type, x, y, z } : { type, x, y };
  };

  /** The rounded points of a line trace as comparable strings. */
  const tuples = (trace: { x: Array<number | null>; y: Array<number | null>; z?: Array<number | null> | undefined }, withZ: boolean): string[] =>
    trace.x.map((x, i) => JSON.stringify(withZ ? [x, trace.y[i], trace.z?.[i]] : [x, trace.y[i]]));
  const roundedInput = (raw: Json, withZ: boolean): string[] => {
    const r = (a: Array<number | null>): Array<number | null> => a.map((v) => (v === null ? null : round4(v)));
    return tuples({ x: r(raw.x as number[]), y: r(raw.y as Array<number | null>), z: withZ ? r(raw.z as Array<number | null>) : undefined }, withZ);
  };
  const isSubsequence = (small: string[], big: string[]): boolean => {
    let j = 0;
    for (const item of small) {
      while (j < big.length && big[j] !== item) j++;
      if (j === big.length) return false;
      j++;
    }
    return true;
  };

  it("1.2b a 100000-point line keeps at most PLOT_LINE_POINTS points", () => {
    const out = lineOf(must(spec2d({}, bigLine())));
    expect(out.x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
    expect(out.x.length).toBeGreaterThan(1);
    expect(out.y).toHaveLength(out.x.length);
  });

  it("1.2b a 100000-point points trace keeps at most PLOT_LINE_POINTS points", () => {
    const out = lineOf(must(spec2d({}, bigLine("points"))));
    expect(out.type).toBe("points");
    expect(out.x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
  });

  it("1.2b decimation keeps the first and last points", () => {
    const raw = bigLine();
    const input = roundedInput(raw, false);
    const out = tuples(lineOf(must(spec2d({}, raw))), false);
    expect(out[0]).toBe(input[0]);
    expect(out[out.length - 1]).toBe(input[input.length - 1]);
  });

  it("1.2b decimation keeps the global minimum and maximum y", () => {
    const out = lineOf(must(spec2d({}, bigLine())));
    const ys = out.y.filter((v): v is number => v !== null);
    expect(Math.min(...ys)).toBe(-1000);
    expect(Math.max(...ys)).toBe(1000);
    expect(out.x).toContain(round4(MIN_AT));
    expect(out.x).toContain(round4(MAX_AT));
  });

  it("1.2b decimation keeps the gaps", () => {
    const out = lineOf(must(spec2d({}, bigLine())));
    const nullXs = out.x.filter((_, i) => out.y[i] === null);
    for (const gap of gapsAt) expect(nullXs).toContain(round4(gap));
  });

  it("1.2b a decimated line is an in-order subsequence of the rounded input", () => {
    const raw = bigLine();
    const out = tuples(lineOf(must(spec2d({}, raw))), false);
    expect(isSubsequence(out, roundedInput(raw, false))).toBe(true);
  });

  it("1.2b decimation keeps z aligned with x and y in 3D", () => {
    const raw = bigLine("line", true);
    const out = lineOf(must(spec3d(raw)));
    expect(out.z).toBeDefined();
    expect(out.z).toHaveLength(out.x.length);
    expect(out.x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
    expect(isSubsequence(tuples(out, true), roundedInput(raw, true))).toBe(true);
  });

  it("1.2b a line of exactly PLOT_LINE_POINTS points is not decimated", () => {
    const x = Array.from({ length: PLOT_LINE_POINTS }, (_, i) => i);
    const y = x.map((i) => (i % 2 === 0 ? 1 : 2));
    const out = lineOf(must(spec2d({}, { type: "line", x, y })));
    expect(out.x).toEqual(x);
    expect(out.y).toEqual(y);
  });

  it("1.2b a line of PLOT_LINE_POINTS + 1 points ends up with at most PLOT_LINE_POINTS", () => {
    const n = PLOT_LINE_POINTS + 1;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = x.map((i) => (i * 7) % 11);
    const out = lineOf(must(spec2d({}, { type: "line", x, y })));
    expect(out.x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
    expect(out.x[0]).toBe(0);
    expect(out.x[out.x.length - 1]).toBe(round4(n - 1));
  });

  it("1.2b decimates every line trace of a spec", () => {
    const spec = must({ ...spec2d(), traces: [bigLine(), line2d(), bigLine("points")] });
    expect(lineOf(spec, 0).x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
    expect(lineOf(spec, 1).x).toEqual([1, 2, 3]);
    expect(lineOf(spec, 2).x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
  });
});

describe("1.2c caps", () => {
  it("1.2c a mesh of PLOT_MESH_TRIANGLES faces is accepted", () => {
    expect(readPlotSpec(spec3d(mesh(PLOT_MESH_TRIANGLES)))).not.toBeNull();
  });

  it("1.2c a mesh of more than PLOT_MESH_TRIANGLES faces returns null", () => {
    expect(readPlotSpec(spec3d(mesh(PLOT_MESH_TRIANGLES + 1)))).toBeNull();
  });

  it("1.2c a surface of exactly PLOT_MESH_TRIANGLES triangles is accepted", () => {
    // 2 * (101 - 1) * (101 - 1) = 20000
    expect(readPlotSpec(spec3d(surface(101, 101)))).not.toBeNull();
  });

  it("1.2c a surface of more than PLOT_MESH_TRIANGLES triangles returns null", () => {
    // 2 * (102 - 1) * (102 - 1) = 20402
    expect(readPlotSpec(spec3d(surface(102, 102)))).toBeNull();
  });

  it("1.2c a surface counts 2*(rows-1)*(cols-1) with rows and cols distinct", () => {
    // rows 2, cols 10002 -> 2 * 1 * 10001 = 20002; rows 2, cols 10001 -> 20000
    expect(readPlotSpec(spec3d(surface(2, 10001)))).not.toBeNull();
    expect(readPlotSpec(spec3d(surface(2, 10002)))).toBeNull();
  });

  it("1.2c the triangle cap counts the whole spec, across traces", () => {
    const half = PLOT_MESH_TRIANGLES / 2;
    expect(readPlotSpec(spec3d(mesh(half), { traces: [mesh(half), mesh(half)] }))).not.toBeNull();
    expect(readPlotSpec(spec3d(mesh(half), { traces: [mesh(half), mesh(half + 1)] }))).toBeNull();
    expect(readPlotSpec(spec3d(mesh(half), { traces: [mesh(half), surface(72, 72)] }))).toBeNull();
  });

  const wideTrace = (seed: number): Json => {
    const n = PLOT_LINE_POINTS;
    const x = Array.from({ length: n }, (_, i) => ((i * 104729 + seed * 31) % 9000 + 1000) / 10000);
    const y = Array.from({ length: n }, (_, i) => ((i * 7919 + seed * 17) % 9000 + 1000) / 10000);
    return { type: "line", x, y };
  };
  const wide = (traces: number): Json => ({ ...spec2d(), traces: Array.from({ length: traces }, (_, i) => wideTrace(i + 1)) });

  it("1.2c formatPlotSpec returns a string for a spec under the cap", () => {
    const out = formatPlotSpec(must(wide(3)));
    expect(typeof out).toBe("string");
    expect(Buffer.byteLength(out as string, "utf8")).toBeLessThanOrEqual(PLOT_SPEC_BYTES);
  });

  it("1.2c formatPlotSpec returns null for a spec over 256 KB serialised", () => {
    const spec = must(wide(20));
    expect(JSON.stringify(spec).length).toBeGreaterThan(PLOT_SPEC_BYTES);
    expect(formatPlotSpec(spec)).toBeNull();
  });

  it("1.2c the cap is measured in UTF-8 bytes, not characters", () => {
    // 150000 two-byte characters: 150000 chars < 262144, 300000 bytes > 262144
    const spec = must(spec2d({ title: "é".repeat(150000) }));
    expect(formatPlotSpec(spec)).toBeNull();
    const ascii = must(spec2d({ title: "e".repeat(150000) }));
    expect(formatPlotSpec(ascii)).not.toBeNull();
  });
});

describe("1.2c formatted output", () => {
  const rich = (): PlotSpec => must({
    traces: [
      { z: [[1, 2], [3, 4]], y: [0, 1], x: [0, 1], color: "#abc", name: "s", type: "surface" },
      { faces: [[0, 1, 2]], vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], color: "#112233", name: "m", type: "mesh" },
      { z: [1, 2], y: [3, 4], x: [5, 6], color: "#000", name: "l", type: "line" },
    ],
    axes: { z: { label: "z" }, y: { label: "y" }, x: { label: "x", range: [0, 1] } },
    title: "Rich\nTitle",
    dim: 3,
    v: 1,
  });

  it("1.2c formatted output is one line", () => {
    const out = formatPlotSpec(rich()) as string;
    expect(out).not.toBeNull();
    expect(out).not.toMatch(/[\r\n]/);
  });

  it("1.2c formatted output is valid JSON that reads back to the same spec", () => {
    const spec = rich();
    const out = formatPlotSpec(spec) as string;
    expect(JSON.parse(out)).toEqual(JSON.parse(JSON.stringify(spec)));
    expect(parsePlotSpec(out)).toEqual(spec);
  });

  it("1.2c formatted keys are ordered v, dim, title, axes, traces", () => {
    const out = formatPlotSpec(rich()) as string;
    expect(Object.keys(JSON.parse(out))).toEqual(["v", "dim", "title", "axes", "traces"]);
  });

  it("1.2c formatted trace keys start with type, name, color and then the data", () => {
    const out = JSON.parse(formatPlotSpec(rich()) as string) as { traces: Json[] };
    expect(Object.keys(out.traces[0]!).slice(0, 3)).toEqual(["type", "name", "color"]);
    expect(Object.keys(out.traces[1]!).slice(0, 3)).toEqual(["type", "name", "color"]);
    expect(Object.keys(out.traces[2]!).slice(0, 3)).toEqual(["type", "name", "color"]);
    expect(Object.keys(out.traces[2]!).slice(3).sort()).toEqual(["x", "y", "z"]);
  });

  it("1.2c formatted keys skip absent optional fields", () => {
    const out = JSON.parse(formatPlotSpec(must(spec2d())) as string) as Json;
    expect(Object.keys(out)).toEqual(["v", "dim", "axes", "traces"]);
    expect(Object.keys((out.traces as Json[])[0]!)).toEqual(["type", "x", "y"]);
  });

  it("1.2c formatting is stable: format, parse, format gives the same text", () => {
    const first = formatPlotSpec(rich()) as string;
    const second = formatPlotSpec(parsePlotSpec(first) as PlotSpec) as string;
    expect(second).toBe(first);
  });

  it("1.2c formatting does not depend on input key order", () => {
    const a = formatPlotSpec(rich());
    const b = formatPlotSpec(must(JSON.parse(JSON.stringify({
      v: 1, dim: 3, title: "Rich\nTitle",
      axes: { x: { label: "x", range: [0, 1] }, y: { label: "y" }, z: { label: "z" } },
      traces: [
        { type: "surface", name: "s", color: "#abc", x: [0, 1], y: [0, 1], z: [[1, 2], [3, 4]] },
        { type: "mesh", name: "m", color: "#112233", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] },
        { type: "line", name: "l", color: "#000", x: [5, 6], y: [3, 4], z: [1, 2] },
      ],
    }))));
    expect(b).toBe(a);
  });

  it("1.2c readPlotSpec is idempotent through format and parse on a decimated, rounded spec", () => {
    const n = 30000;
    const x = Array.from({ length: n }, (_, i) => i * 1.23456);
    const y = Array.from({ length: n }, (_, i) => (i % 97 === 0 ? null : Math.sin(i) * 3.14159));
    const spec = must(spec2d({ title: "t" }, { type: "line", x, y }));
    const text = formatPlotSpec(spec) as string;
    expect(text).not.toBeNull();
    const again = formatPlotSpec(readPlotSpec(parsePlotSpec(text)) as PlotSpec);
    expect(again).toBe(text);
  });

  it("1.2c a -0 never reaches the formatted text", () => {
    const text = formatPlotSpec(must(spec2d({}, line2d({ x: [-0, 1, 2] })))) as string;
    expect(text).not.toContain("-0,");
    expect(text).not.toContain("-0]");
  });
});

describe("A1 the spec validates, rounds, decimates and caps as D1", () => {
  it("A1 one pass: validates, rounds, decimates, drops invalid optionals and serialises on one line", () => {
    const n = 50000;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = Array.from({ length: n }, (_, i) => (i === 25000 ? null : Math.sin(i / 10) * 1.23456));
    const spec = must({
      v: 1, dim: 2, title: "A1", junk: true,
      axes: { x: { label: "t", range: [5, 1] }, y: { log: "no" } },
      traces: [{ type: "line", name: "s", color: "nope", x, y }],
    });
    const trace = lineOf(spec);
    expect(spec.axes.x.range).toBeUndefined();
    expect(spec.axes.y.log).toBeUndefined();
    expect(trace.color).toBeUndefined();
    expect(trace.x.length).toBeLessThanOrEqual(PLOT_LINE_POINTS);
    expect(trace.y.some((v) => v === null)).toBe(true);
    for (const v of trace.y) if (v !== null) expect(v).toBe(Number(v.toPrecision(4)));
    const text = formatPlotSpec(spec) as string;
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/\n/);
    expect(readPlotSpec(spec3d(mesh(PLOT_MESH_TRIANGLES + 1)))).toBeNull();
  });
});
