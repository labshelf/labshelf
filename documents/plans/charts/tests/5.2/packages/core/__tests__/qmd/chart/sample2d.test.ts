/**
 * Tests fnTraces2d (plan charts, spec 5.2, D8): the Plotly traces of a 2D function y=f(x), x=f(y), relation, parametric
 * or polar, resampled with the chart's variables, with null gaps at breaks, dashed strict relations, a fill at opacity
 * 0.25 toward the view edge, and the message, offset and part of a bad expression (acceptance 5.2a, 5.2b, 5.2c, 5.2d).
 */
import { fnTraces2d } from "../../../src/qmd/chart/sample2d";
import type { ChartFn, ChartVar } from "../../../src/qmd/chart/model";

type Trace = {
  x: unknown[];
  y: unknown[];
  fill?: unknown;
  fillcolor?: unknown;
  opacity?: unknown;
  line?: { dash?: unknown };
  [key: string]: unknown;
};
type Point = [number, number];

const VIEW = { x: [-10, 10] as [number, number], y: [-10, 10] as [number, number] };
const COLOUR = "#3366cc";
const NONE: readonly ChartVar[] = [];

function run(fn: ChartFn, vars: readonly ChartVar[] = NONE, view = VIEW): { traces: Trace[]; error: ReturnType<typeof fnTraces2d>["error"] } {
  const { traces, error } = fnTraces2d(fn, vars, view, COLOUR);
  return { traces: traces as Trace[], error };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Finite [x, y] pairs of a trace, null gaps skipped. */
function points(trace: Trace): Point[] {
  const xs: unknown[] = trace.x;
  const ys: unknown[] = trace.y;
  const out: Point[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    if (isNum(xs[i]) && isNum(ys[i])) { out.push([xs[i] as number, ys[i] as number]); }
  }
  return out;
}

function allPoints(traces: Trace[]): Point[] {
  return traces.flatMap(points);
}

/** Index of the entries of a trace where x or y is null. */
function gaps(trace: Trace): number[] {
  const xs: unknown[] = trace.x;
  const ys: unknown[] = trace.y;
  const out: number[] = [];
  for (let i = 0; i < Math.max(xs.length, ys.length); i++) {
    if (xs[i] === null || ys[i] === null) { out.push(i); }
  }
  return out;
}

const filled = (t: Trace): boolean => typeof t.fill === "string" && t.fill !== "none";
const dashed = (t: Trace): boolean => typeof t.line?.dash === "string" && t.line.dash !== "solid";

function alphaOk(t: Trace): boolean {
  if (t.opacity === 0.25) { return true; }
  const m = /^rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)$/.exec(String(t.fillcolor ?? ""));
  return m !== null && Math.abs(Number(m[1]) - 0.25) < 1e-9;
}

describe("5.2a y = f(x)", () => {
  const fn: ChartFn = { kind: "y", rel: "=", expr: ["4*sin(x) + 5*cos(x/2)"] };

  it("5.2a gives one trace with no error", () => {
    const { traces, error } = run(fn);
    expect(error).toBeNull();
    expect(traces).toHaveLength(1);
  });

  it("5.2a the trace has many finite points and no gap", () => {
    const [trace] = run(fn).traces;
    expect(trace!.x.length).toBe(trace!.y.length);
    expect(trace!.x.length).toBeGreaterThan(100);
    expect(gaps(trace!)).toEqual([]);
    expect(points(trace!)).toHaveLength(trace!.x.length);
  });

  it("5.2a the points follow the function over the x view", () => {
    const pts = points(run(fn).traces[0]!);
    for (const [x, y] of pts) { expect(y).toBeCloseTo(4 * Math.sin(x) + 5 * Math.cos(x / 2), 3); }
    const xs = pts.map(([x]) => x);
    expect(Math.min(...xs)).toBeCloseTo(-10, 6);
    expect(Math.max(...xs)).toBeCloseTo(10, 6);
  });

  it("5.2a points are not rounded to 4 significant digits", () => {
    const pts = points(run({ kind: "y", rel: "=", expr: ["x/3"] }).traces[0]!);
    expect(pts.some(([, y]) => Number(y.toPrecision(4)) !== y)).toBe(true);
  });

  it("5.2a 1/x has a null gap at 0", () => {
    const { traces, error } = run({ kind: "y", rel: "=", expr: ["1/x"] });
    expect(error).toBeNull();
    const all = traces.flatMap((t) => gaps(t).map((i) => ({ t, i })));
    expect(all.length).toBeGreaterThanOrEqual(1);
    const pts = allPoints(traces);
    expect(pts.some(([x]) => x < -1)).toBe(true);
    expect(pts.some(([x]) => x > 1)).toBe(true);
    expect(pts.every(([x]) => Math.abs(x) > 0.01)).toBe(true);
    expect(pts.every(([, y]) => Math.abs(y) <= 10 + 1e-9)).toBe(true);
  });

  it("5.2a the gap of 1/x sits between a point left of 0 and a point right of 0", () => {
    const { traces } = run({ kind: "y", rel: "=", expr: ["1/x"] });
    let crossed = false;
    for (const t of traces) {
      const xs: unknown[] = t.x;
      const ys: unknown[] = t.y;
      let last: number | null = null;
      let afterGap = false;
      for (let i = 0; i < xs.length; i++) {
        if (isNum(xs[i]) && isNum(ys[i])) {
          if (afterGap && last !== null && last < 0 && (xs[i] as number) > 0) { crossed = true; }
          last = xs[i] as number;
          afterGap = false;
        } else {
          afterGap = true;
        }
      }
    }
    expect(crossed).toBe(true);
  });

  it("5.2a the curve is clipped to the y view", () => {
    const pts = allPoints(run({ kind: "y", rel: "=", expr: ["x^3"] }).traces);
    expect(pts.length).toBeGreaterThan(10);
    expect(pts.every(([, y]) => y >= -10 - 1e-9 && y <= 10 + 1e-9)).toBe(true);
  });

  it("5.2a a narrower x view limits the sampled x", () => {
    const pts = allPoints(run(fn, NONE, { x: [0, 2], y: [-10, 10] }).traces);
    const xs = pts.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(2 + 1e-9);
  });

  it("5.2a a domain on the function limits the sampled x", () => {
    const pts = allPoints(run({ ...fn, domain: [1, 3] }).traces);
    const xs = pts.map(([x]) => x);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(1 - 1e-9);
    expect(Math.max(...xs)).toBeLessThanOrEqual(3 + 1e-9);
  });
});

describe("5.2a x = f(y)", () => {
  it("5.2a the axes are swapped: x follows f of y", () => {
    const { traces, error } = run({ kind: "x", rel: "=", expr: ["y^2"] });
    expect(error).toBeNull();
    const pts = allPoints(traces);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) { expect(x).toBeCloseTo(y * y, 3); }
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...ys)).toBeLessThan(-3);
    expect(Math.max(...ys)).toBeGreaterThan(3);
  });
});

describe("5.2b relations", () => {
  it("5.2b y < x^2 draws a dashed curve", () => {
    const { traces, error } = run({ kind: "y", rel: "<", expr: ["x^2"] });
    expect(error).toBeNull();
    expect(traces.some(dashed)).toBe(true);
  });

  it("5.2b y < x^2 fills a region at opacity 0.25", () => {
    const { traces } = run({ kind: "y", rel: "<", expr: ["x^2"] });
    const fills = traces.filter(filled);
    expect(fills.length).toBeGreaterThanOrEqual(1);
    expect(fills.every(alphaOk)).toBe(true);
  });

  it("5.2b y > x^2 draws a dashed curve", () => {
    expect(run({ kind: "y", rel: ">", expr: ["x^2"] }).traces.some(dashed)).toBe(true);
  });

  it("5.2b y >= x draws a solid line", () => {
    const { traces } = run({ kind: "y", rel: ">=", expr: ["x"] });
    expect(traces.some((t) => points(t).length > 10)).toBe(true);
    expect(traces.some(dashed)).toBe(false);
  });

  it("5.2b y <= x^2 draws a solid curve", () => {
    expect(run({ kind: "y", rel: "<=", expr: ["x^2"] }).traces.some(dashed)).toBe(false);
  });

  it("5.2b y >= x fills a region at opacity 0.25", () => {
    const fills = run({ kind: "y", rel: ">=", expr: ["x"] }).traces.filter(filled);
    expect(fills.length).toBeGreaterThanOrEqual(1);
    expect(fills.every(alphaOk)).toBe(true);
  });

  it("5.2b an equality fills nothing and is solid", () => {
    const { traces } = run({ kind: "y", rel: "=", expr: ["x^2"] });
    expect(traces.some(filled)).toBe(false);
    expect(traces.some(dashed)).toBe(false);
  });

  it("5.2b y < f fills down to the bottom edge of the view and stays under the curve", () => {
    const fills = run({ kind: "y", rel: "<", expr: ["0.5*sin(x)"] }).traces.filter(filled);
    const pts = allPoints(fills);
    expect(pts.length).toBeGreaterThan(4);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-10, 6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("5.2b y <= f fills down to the bottom edge of the view", () => {
    const ys = allPoints(run({ kind: "y", rel: "<=", expr: ["0.5*sin(x)"] }).traces.filter(filled)).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-10, 6);
    expect(Math.max(...ys)).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("5.2b y > f fills up to the top edge of the view and stays over the curve", () => {
    const ys = allPoints(run({ kind: "y", rel: ">", expr: ["0.5*sin(x)"] }).traces.filter(filled)).map(([, y]) => y);
    expect(ys.length).toBeGreaterThan(4);
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
  });

  it("5.2b y >= f fills up to the top edge of the view", () => {
    const ys = allPoints(run({ kind: "y", rel: ">=", expr: ["0.5*sin(x)"] }).traces.filter(filled)).map(([, y]) => y);
    expect(Math.max(...ys)).toBeCloseTo(10, 6);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.5 - 1e-6);
  });

  it("5.2b the fill follows the view edge when the view changes", () => {
    const view = { x: [-5, 5] as [number, number], y: [-3, 3] as [number, number] };
    const ys = allPoints(run({ kind: "y", rel: "<", expr: ["0.5*sin(x)"] }, NONE, view).traces.filter(filled)).map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(-3, 6);
  });
});

describe("5.2c parametric and polar", () => {
  it("5.2c x = cos t, y = sin t traces the unit circle", () => {
    const { traces, error } = run({ kind: "param", expr: ["cos(t)", "sin(t)"] });
    expect(error).toBeNull();
    const pts = allPoints(traces);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) { expect(Math.hypot(x, y)).toBeCloseTo(1, 3); }
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThan(-0.99);
    expect(Math.max(...xs)).toBeGreaterThan(0.99);
    expect(Math.min(...ys)).toBeLessThan(-0.99);
    expect(Math.max(...ys)).toBeGreaterThan(0.99);
  });

  it("5.2c the default domain of t is 0 to 2 pi: the circle starts and ends at (1, 0)", () => {
    const pts = points(run({ kind: "param", expr: ["cos(t)", "sin(t)"] }).traces[0]!);
    expect(pts[0]![0]).toBeCloseTo(1, 3);
    expect(pts[0]![1]).toBeCloseTo(0, 3);
    const last = pts[pts.length - 1]!;
    expect(last[0]).toBeCloseTo(1, 3);
    expect(last[1]).toBeCloseTo(0, 3);
  });

  it("5.2c a domain on a parametric function limits t", () => {
    const pts = allPoints(run({ kind: "param", expr: ["cos(t)", "sin(t)"], domain: [0, Math.PI] }).traces);
    expect(pts.every(([, y]) => y >= -1e-6)).toBe(true);
    expect(Math.max(...pts.map(([x]) => x))).toBeGreaterThan(0.99);
    expect(Math.min(...pts.map(([x]) => x))).toBeLessThan(-0.99);
  });

  it("5.2c steps sets the number of parametric samples", () => {
    const few = allPoints(run({ kind: "param", expr: ["cos(t)", "sin(t)"], steps: 20 }).traces);
    const many = allPoints(run({ kind: "param", expr: ["cos(t)", "sin(t)"], steps: 800 }).traces);
    expect(few.length).toBeLessThan(many.length);
    expect(few.length).toBeLessThanOrEqual(25);
  });

  it("5.2c a jump taller than the view breaks a parametric run with a null gap", () => {
    const { traces } = run({ kind: "param", expr: ["t", "tan(t)"], domain: [0, 3] });
    expect(traces.flatMap(gaps).length).toBeGreaterThanOrEqual(1);
  });

  it("5.2c r = 1 (polar) traces the unit circle", () => {
    const { traces, error } = run({ kind: "polar", expr: ["1"] });
    expect(error).toBeNull();
    const pts = allPoints(traces);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) { expect(Math.hypot(x, y)).toBeCloseTo(1, 3); }
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    expect(Math.min(...xs)).toBeLessThan(-0.99);
    expect(Math.max(...xs)).toBeGreaterThan(0.99);
    expect(Math.min(...ys)).toBeLessThan(-0.99);
    expect(Math.max(...ys)).toBeGreaterThan(0.99);
  });

  it("5.2c r = theta (polar) puts r on x = r cos theta, y = r sin theta", () => {
    const { traces, error } = run({ kind: "polar", expr: ["theta"], domain: [0, 6] });
    expect(error).toBeNull();
    const pts = allPoints(traces);
    expect(pts[0]![0]).toBeCloseTo(0, 3);
    expect(pts[0]![1]).toBeCloseTo(0, 3);
    const last = pts[pts.length - 1]!;
    expect(last[0]).toBeCloseTo(6 * Math.cos(6), 3);
    expect(last[1]).toBeCloseTo(6 * Math.sin(6), 3);
  });

  it("5.2c the symbol θ names the polar angle too", () => {
    const { traces, error } = run({ kind: "polar", expr: ["θ"], domain: [0, 6] });
    expect(error).toBeNull();
    const last = allPoints(traces).at(-1)!;
    expect(last[0]).toBeCloseTo(6 * Math.cos(6), 3);
    expect(last[1]).toBeCloseTo(6 * Math.sin(6), 3);
  });
});

describe("5.2d variables and errors", () => {
  const fn: ChartFn = { kind: "y", rel: "=", expr: ["a*x"] };

  it("5.2d a variable a in y = a*x scales the samples", () => {
    const { traces, error } = run(fn, [{ name: "a", value: 2 }]);
    expect(error).toBeNull();
    const pts = allPoints(traces);
    expect(pts.length).toBeGreaterThan(10);
    for (const [x, y] of pts) { expect(y).toBeCloseTo(2 * x, 3); }
  });

  it("5.2d changing the value of a changes the samples", () => {
    const two = allPoints(run(fn, [{ name: "a", value: 2 }]).traces);
    const half = allPoints(run(fn, [{ name: "a", value: 0.5 }]).traces);
    expect(half.length).toBeGreaterThan(10);
    for (const [x, y] of half) { expect(y).toBeCloseTo(0.5 * x, 3); }
    expect(JSON.stringify(half)).not.toEqual(JSON.stringify(two));
  });

  it("5.2d a variable works in a parametric function", () => {
    const pts = allPoints(run({ kind: "param", expr: ["a*cos(t)", "a*sin(t)"] }, [{ name: "a", value: 3 }]).traces);
    expect(pts.length).toBeGreaterThan(100);
    for (const [x, y] of pts) { expect(Math.hypot(x, y)).toBeCloseTo(3, 3); }
  });

  it("5.2d a bad expression returns its message, offset and part", () => {
    const { error } = run({ kind: "y", rel: "=", expr: ["2*x +"] });
    expect(error).not.toBeNull();
    expect(typeof error!.message).toBe("string");
    expect(error!.message.length).toBeGreaterThan(0);
    expect(Number.isInteger(error!.at)).toBe(true);
    expect(error!.at).toBeGreaterThanOrEqual(0);
    expect(error!.part).toBe(0);
  });

  it("5.2d the part is the index of the bad component of a parametric function", () => {
    const { error } = run({ kind: "param", expr: ["cos(t)", "sin(t) +"] });
    expect(error).not.toBeNull();
    expect(error!.part).toBe(1);
  });

  it("5.2d an unknown name is an error with an offset at the name", () => {
    const { error } = run({ kind: "y", rel: "=", expr: ["x + foo"] });
    expect(error).not.toBeNull();
    expect(error!.part).toBe(0);
    expect(error!.at).toBeGreaterThanOrEqual(3);
    expect(error!.at).toBeLessThanOrEqual(6);
  });

  it("5.2d a good expression has no error", () => {
    expect(run({ kind: "y", rel: "=", expr: ["sin(x)"] }).error).toBeNull();
  });
});
