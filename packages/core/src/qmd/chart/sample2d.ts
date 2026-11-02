// The Plotly traces of a 2D function of a chart (D8): y = f(x), x = f(y), relations as shaded regions, parametric x(t), y(t),
// polar r(θ) and implicit F(x, y) = 0, evaluated with the chart's variables. A bad expression comes back as its message,
// offset and part instead of traces. DOM-free.
import { parseExpr } from "../drawing/expr.js";
import { sampleFunction } from "../drawing/sample.js";
import { marchingSquares } from "./implicit.js";
import type { ChartFn, ChartVar } from "./model.js";

type View = { x: [number, number]; y: [number, number] };
type Env = Record<string, number>;
type Evaluate = (x: number, env: Readonly<Record<string, number>>) => number;
type FnError = { message: string; at: number; part: number };
type Result = { traces: Record<string, unknown>[]; error: FnError | null };
type Point = readonly [number, number];

const CURVE_POINTS = 1000;
const CURVE_INTERVALS = 800;
const PARAM_STEPS = 400;
const IMPLICIT_CELLS = 200;
const FILL_OPACITY = 0.25;
const LINE_WIDTH = 2;

/** The expression parts of a function parsed against its own variable names and the chart's variables; the first failure is the error. */
function parseParts(expr: readonly string[], count: number, own: readonly string[], chartVars: readonly ChartVar[]): { parts: Evaluate[]; error: null } | { parts: null; error: FnError } {
  const params = chartVars.map((v) => v.name).filter((name) => !own.includes(name));
  const parts: Evaluate[] = [];
  for (let part = 0; part < count; part += 1) {
    const text = expr[part];
    if (text === undefined) { return { parts: null, error: { message: "missing expression", at: 0, part } }; }
    const parsed = parseExpr(text, { vars: own, params });
    if (!parsed.ok) { return { parts: null, error: { message: parsed.error, at: parsed.at, part } }; }
    parts.push(parsed.evaluate);
  }
  return { parts, error: null };
}

function envOf(chartVars: readonly ChartVar[]): Env {
  const env: Env = {};
  for (const v of chartVars) { env[v.name] = v.value; }
  return env;
}

/** Polyline coordinates for Plotly: the runs joined by a null gap. */
function joinRuns(runs: readonly (readonly Point[])[], swap: boolean): { x: (number | null)[]; y: (number | null)[] } {
  const x: (number | null)[] = [];
  const y: (number | null)[] = [];
  runs.forEach((run, i) => {
    if (i > 0) { x.push(null); y.push(null); }
    for (const [a, b] of run) { x.push(swap ? b : a); y.push(swap ? a : b); }
  });
  return { x, y };
}

function lineTrace(runs: readonly (readonly Point[])[], swap: boolean, fn: ChartFn, colour: string, dash?: string): Record<string, unknown> {
  const line: Record<string, unknown> = { color: colour, width: LINE_WIDTH };
  if (dash !== undefined) { line.dash = dash; }
  const trace: Record<string, unknown> = { type: "scatter", mode: "lines", ...joinRuns(runs, swap), line, connectgaps: false };
  if (fn.name !== undefined) { trace.name = fn.name; } else { trace.showlegend = false; }
  return trace;
}

/** The domain of a function inside the view; null when they do not meet. */
function domainIn(fn: ChartFn, view: readonly [number, number]): [number, number] | null {
  const lo = Math.max(fn.domain?.[0] ?? view[0], view[0]);
  const hi = Math.min(fn.domain?.[1] ?? view[1], view[1]);
  return lo <= hi ? [lo, hi] : null;
}

/** y = f(x) or x = f(y) with an optional relation: the curve, and the region to the view edge for a relation. */
function axisFunction(fn: ChartFn, vars: readonly ChartVar[], view: View, colour: string): Result {
  const swap = fn.kind === "x";
  const own = swap ? "y" : "x";
  const { parts, error } = parseParts(fn.expr, 1, [own], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const f = (v: number): number => parts[0]!(v, env);
  const [domainView, valueView] = swap ? [view.y, view.x] : [view.x, view.y];
  const domain = domainIn(fn, domainView);
  if (domain === null) { return { traces: [], error: null }; }
  const options = { round: false, maxPoints: CURVE_POINTS, intervals: CURVE_INTERVALS };
  const rel = fn.rel ?? "=";
  const dashed = rel === "<" || rel === ">";
  const traces = [lineTrace(sampleFunction(f, domain, valueView, options), swap, fn, colour, dashed ? "dash" : undefined)];
  if (rel !== "=") {
    const below = rel === "<" || rel === "<=";
    const edge = below ? valueView[0] : valueView[1];
    const clamped = (v: number): number => Math.min(Math.max(f(v), valueView[0]), valueView[1]);
    const polygons = sampleFunction(clamped, domain, valueView, options).map((run): Point[] => {
      const first = run[0]!;
      const last = run[run.length - 1]!;
      return [...run, [last[0], edge], [first[0], edge], first];
    });
    traces.push({ type: "scatter", mode: "lines", ...joinRuns(polygons, swap), fill: "toself", fillcolor: colour, opacity: FILL_OPACITY, line: { width: 0, color: colour }, hoverinfo: "skip", showlegend: false });
  }
  return { traces, error: null };
}

function stepCount(steps: ChartFn["steps"]): number {
  const n = Array.isArray(steps) ? steps[0] : steps;
  return n !== undefined && Number.isFinite(n) && n >= 1 ? Math.floor(n) : PARAM_STEPS;
}

/** Runs of points, broken at a non-finite point or a jump taller or wider than the view. */
function splitJumps(points: readonly (Point | null)[], view: View): Point[][] {
  const width = view.x[1] - view.x[0];
  const height = view.y[1] - view.y[0];
  const runs: Point[][] = [];
  let current: Point[] = [];
  const flush = (): void => {
    if (current.length > 0) { runs.push(current); }
    current = [];
  };
  for (const point of points) {
    if (point === null || !Number.isFinite(point[0]) || !Number.isFinite(point[1])) { flush(); continue; }
    const last = current[current.length - 1];
    if (last !== undefined && (Math.abs(point[1] - last[1]) > height || Math.abs(point[0] - last[0]) > width)) { flush(); }
    current.push(point);
  }
  flush();
  return runs;
}

/** Parametric x(t), y(t) and polar r(θ): the parameter uniform over the domain (default 0 to 2π). */
function parametric(fn: ChartFn, vars: readonly ChartVar[], view: View, colour: string): Result {
  const polar = fn.kind === "polar";
  const { parts, error } = parseParts(fn.expr, polar ? 1 : 2, [polar ? "θ" : "t"], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const [lo, hi] = fn.domain ?? [0, 2 * Math.PI];
  const steps = stepCount(fn.steps);
  const points: Point[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i === steps ? hi : lo + ((hi - lo) * i) / steps;
    if (polar) {
      const r = parts[0]!(t, env);
      points.push([r * Math.cos(t), r * Math.sin(t)]);
    } else {
      points.push([parts[0]!(t, env), parts[1]!(t, env)]);
    }
  }
  return { traces: [lineTrace(splitJumps(points, view), false, fn, colour)], error: null };
}

/** Implicit F(x, y) = 0 (or lhs - rhs with two parts) by marching squares over the view. */
function implicit(fn: ChartFn, vars: readonly ChartVar[], view: View, colour: string): Result {
  const { parts, error } = parseParts(fn.expr, fn.expr.length > 1 ? 2 : 1, ["x", "y"], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const withY = (y: number): Env => ({ ...env, y });
  const f = (x: number, y: number): number => {
    const scope = withY(y);
    return parts.length > 1 ? parts[0]!(x, scope) - parts[1]!(x, scope) : parts[0]!(x, scope);
  };
  const lines = marchingSquares(f, view.x, view.y, IMPLICIT_CELLS);
  return { traces: [lineTrace(lines, false, fn, colour)], error: null };
}

/** The Plotly traces of one 2D function over `view`, in `colour`, with the chart's variables; or the first bad expression. Other kinds give no traces. */
export function fnTraces2d(fn: ChartFn, vars: readonly ChartVar[], view: { x: [number, number]; y: [number, number] }, colour: string): { traces: Record<string, unknown>[]; error: { message: string; at: number; part: number } | null } {
  switch (fn.kind) {
    case "y":
    case "x": return axisFunction(fn, vars, view, colour);
    case "param":
    case "polar": return parametric(fn, vars, view, colour);
    case "implicit": return implicit(fn, vars, view, colour);
    default: return { traces: [], error: null };
  }
}
