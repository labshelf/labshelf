// The Plotly traces of a 3D function of a chart (D8): z = f(x, y) on a grid into a surface, a parametric surface
// x(u, v), y(u, v), z(u, v) into a surface with three matrices, and a 3D curve x(t), y(t), z(t) into a scatter3d line,
// evaluated with the chart's variables. A bad expression comes back as its message, offset and part instead of traces. DOM-free.
import { envOf, parseParts } from "./fnParts.js";
import type { Env, Evaluate, FnError } from "./fnParts.js";
import type { ChartFn, ChartVar } from "./model.js";

type Result = { traces: Record<string, unknown>[]; error: FnError | null };
type Matrix = (number | null)[][];

const DEFAULT_STEPS = 30;
const MIN_STEPS = 2;
const MAX_STEPS = 200;
const DEFAULT_SPAN: readonly [number, number] = [-10, 10];
const DEFAULT_ANGLE: readonly [number, number] = [0, 2 * Math.PI];

/** A step count clamped to [2, 200] and rounded; the default when it is missing or not a number. */
function clampSteps(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) { return DEFAULT_STEPS; }
  return Math.min(MAX_STEPS, Math.max(MIN_STEPS, Math.round(n)));
}

/** The step count each resolution samples at when a function names no steps of its own. */
const RESOLUTION_STEPS: Readonly<Record<NonNullable<ChartFn["resolution"]>, number>> = { low: 20, medium: DEFAULT_STEPS, high: 60 };

/** The step counts of the first and second variable: the function's own, else those of its resolution. */
function stepsOf(fn: ChartFn): [number, number] {
  const { steps } = fn;
  if (steps === undefined && fn.resolution !== undefined) { const n = RESOLUTION_STEPS[fn.resolution]; return [n, n]; }
  return Array.isArray(steps) ? [clampSteps(steps[0]), clampSteps(steps[1])] : [clampSteps(steps), clampSteps(steps)];
}

/** `count` values from `lo` to `hi`, both included. */
function linspace(domain: readonly [number, number], count: number): number[] {
  const [lo, hi] = domain;
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? hi : lo + ((hi - lo) * i) / (count - 1)));
}

const finiteOrNull = (value: number): number | null => (Number.isFinite(value) ? value : null);

function named(trace: Record<string, unknown>, fn: ChartFn): Record<string, unknown> {
  if (fn.name !== undefined) { trace.name = fn.name; }
  if (fn.opacity !== undefined) { trace.opacity = fn.opacity; }
  return trace.type === "surface" ? look(trace, fn) : trace;
}

/** A surface's look: one colour when the function has one, and its wire mesh (contour lines along x and y) for `mesh` or `both`. */
function look(trace: Record<string, unknown>, fn: ChartFn): Record<string, unknown> {
  if (fn.color !== undefined) { trace.colorscale = [[0, fn.color], [1, fn.color]]; }
  if (fn.render === "mesh" || fn.render === "both") {
    const line = { show: true, color: fn.render === "mesh" ? fn.color ?? "#444444" : "rgba(30,30,30,0.35)", width: 1 };
    trace.contours = { x: line, y: line };
    if (fn.render === "mesh") { trace.hidesurface = true; }
  }
  return trace;
}

/** z = f(x, y): z[j][i] at (x[i], y[j]). */
function surface(fn: ChartFn, vars: readonly ChartVar[], colourscale: string): Result {
  const { parts, error } = parseParts(fn.expr, 1, ["x", "y"], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const [nx, ny] = stepsOf(fn);
  const x = linspace(fn.domain ?? DEFAULT_SPAN, nx);
  const y = linspace(fn.domain2 ?? DEFAULT_SPAN, ny);
  const z: Matrix = y.map((yj) => {
    const scope: Env = { ...env, y: yj };
    return x.map((xi) => finiteOrNull(parts[0]!(xi, scope)));
  });
  return { traces: [named({ type: "surface", x, y, z, colorscale: colourscale, showscale: false }, fn)], error: null };
}

/** x(u, v), y(u, v), z(u, v): three matrices of m rows (v) of n values (u). */
function paramSurface(fn: ChartFn, vars: readonly ChartVar[], colourscale: string): Result {
  const { parts, error } = parseParts(fn.expr, 3, ["u", "v"], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const [nu, nv] = stepsOf(fn);
  const us = linspace(fn.domain ?? DEFAULT_ANGLE, nu);
  const vs = linspace(fn.domain2 ?? DEFAULT_ANGLE, nv);
  const rows = (part: Evaluate): Matrix => vs.map((v) => {
    const scope: Env = { ...env, v };
    return us.map((u) => finiteOrNull(part(u, scope)));
  });
  const [x, y, z] = parts.map(rows);
  return { traces: [named({ type: "surface", x, y, z, colorscale: colourscale, showscale: false }, fn)], error: null };
}

/** x(t), y(t), z(t) as a scatter3d line. */
function curve(fn: ChartFn, vars: readonly ChartVar[]): Result {
  const { parts, error } = parseParts(fn.expr, 3, ["t"], vars);
  if (parts === null) { return { traces: [], error }; }
  const env = envOf(vars);
  const [n] = stepsOf(fn);
  const ts = linspace(fn.domain ?? DEFAULT_ANGLE, n);
  const [x, y, z] = parts.map((part) => ts.map((t) => finiteOrNull(part(t, env))));
  const trace: Record<string, unknown> = { type: "scatter3d", mode: "lines", x, y, z };
  if (fn.color !== undefined) { trace.line = { color: fn.color }; }
  return { traces: [named(trace, fn)], error: null };
}

/** The Plotly traces of one 3D function (surface, param3d or curve3d) with the chart's variables and a colourscale for the surfaces; or the first bad expression. Other kinds give no traces. */
export function fnTraces3d(fn: ChartFn, vars: readonly ChartVar[], colourscale: string): { traces: Record<string, unknown>[]; error: { message: string; at: number; part: number } | null } {
  switch (fn.kind) {
    case "surface": return surface(fn, vars, colourscale);
    case "param3d": return paramSurface(fn, vars, colourscale);
    case "curve3d": return curve(fn, vars);
    default: return { traces: [], error: null };
  }
}
