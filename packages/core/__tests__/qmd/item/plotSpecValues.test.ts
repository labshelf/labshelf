// Tests the number handling of the labshelf-plot v1 spec: values are rounded to 4 significant digits and long lines are decimated.
// They are checked through readPlotSpec, which applies both.
import type { PlotMeshTrace, PlotSurfaceTrace } from "../../../src/qmd/item/plotSpec";
import { PLOT_LINE_POINTS, line2d, lineOf, must, round4, spec2d, spec3d, type Json } from "./plotSpecHarness";

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
