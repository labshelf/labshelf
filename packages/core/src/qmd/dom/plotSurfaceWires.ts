// The wireframe of a 3D plot's surfaces and meshes: their grid lines as polylines (lifted off the surface for an overlay), the
// cap on how many segments a wireframe draws, and the height range of the Viridis colouring.
import type { PlotMeshTrace, PlotSpec, PlotSurfaceTrace, PlotValue } from "../item/index.js";

/** The most edge segments a wireframe draws over the whole spec; a spec with more is drawn as a surface. */
const PLOT_WIREFRAME_SEGMENTS = 30000;

/** True when `spec` is 3D and holds a surface or mesh trace, the traces a surface style applies to. */
export function hasPlotSurfaces(spec: PlotSpec): boolean {
  return spec.dim === 3 && spec.traces.some((trace) => trace.type === "surface" || trace.type === "mesh");
}

export type Vec3 = [number, number, number];

const finiteNumber = (value: PlotValue | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/**
 * The wire of one surface or mesh: points joined into one polyline with null breaks, how many segments it holds, and per point
 * the small offset (data units) that lifts it off the surface along the surface's normal; 0 when no lift was asked for.
 */
export interface Wire { x: PlotValue[]; y: PlotValue[]; z: PlotValue[]; lift: (Vec3 | null)[]; segments: number }

function pushPoint(wire: Wire, p: Vec3, lift: Vec3): void {
  wire.x.push(p[0]); wire.y.push(p[1]); wire.z.push(p[2]); wire.lift.push(lift);
}

function pushBreak(wire: Wire): void {
  wire.x.push(null); wire.y.push(null); wire.z.push(null); wire.lift.push(null);
}

/** How far a wire drawn over its surface is lifted off it, in units of Plotly's scene cube: enough to beat depth fighting, too little to see. */
const WIRE_LIFT = 0.004;
const NO_LIFT: Vec3 = [0, 0, 0];

/**
 * The per-axis factors that map data units to Plotly's scene cube (1 over each axis's span over the surfaces and meshes, or its
 * set range), or null when an axis is logarithmic and a lift in data units would not be even.
 */
export function sceneScale(spec: PlotSpec): Vec3 | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  const add = (axis: 0 | 1 | 2, value: PlotValue | undefined): void => {
    if (!finiteNumber(value)) return;
    lo[axis] = Math.min(lo[axis], value);
    hi[axis] = Math.max(hi[axis], value);
  };
  for (const trace of spec.traces) {
    if (trace.type === "surface") {
      for (const x of trace.x) add(0, x);
      for (const y of trace.y) add(1, y);
      for (const row of trace.z) for (const z of row) add(2, z);
    } else if (trace.type === "mesh") {
      for (const v of trace.vertices) { add(0, v[0]); add(1, v[1]); add(2, v[2]); }
    }
  }
  const scale: Vec3 = [1, 1, 1];
  for (const [n, name] of (["x", "y", "z"] as const).entries()) {
    const axis = spec.axes[name];
    if (axis?.log === true) return null;
    const span = axis?.range ? Math.abs(axis.range[1] - axis.range[0]) : hi[n]! - lo[n]!;
    scale[n] = span > 0 && Number.isFinite(span) ? 1 / span : 1;
  }
  return scale;
}

/** A unit normal in scene-cube units turned into a WIRE_LIFT offset in data units. */
function liftOf(normal: Vec3, scale: Vec3): Vec3 {
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  if (!(length > 0)) return NO_LIFT;
  return [normal[0] / length * WIRE_LIFT / scale[0], normal[1] / length * WIRE_LIFT / scale[1], normal[2] / length * WIRE_LIFT / scale[2]];
}

/** The slope dz/dc at grid index `n` from its finite neighbours (central where it can, one-sided at an edge or a gap). */
function gridSlope(coords: readonly number[], zAt: (n: number) => number | null, n: number): number {
  const here = zAt(n)!;
  const prev = n > 0 ? zAt(n - 1) : null;
  const next = n < coords.length - 1 ? zAt(n + 1) : null;
  const [ca, za] = prev !== null ? [coords[n - 1]!, prev] : [coords[n]!, here];
  const [cb, zb] = next !== null ? [coords[n + 1]!, next] : [coords[n]!, here];
  return cb !== ca ? (zb - za) / (cb - ca) : 0;
}

/** A surface grid's rows and columns as polylines, broken at a missing z; lifted along the grid's normal when `scale` is given. */
function surfaceWire(trace: PlotSurfaceTrace, scale: Vec3 | null): Wire {
  const wire: Wire = { x: [], y: [], z: [], lift: [], segments: 0 };
  const zAt = (i: number, j: number): number | null => {
    const z = trace.z[j]?.[i];
    return finiteNumber(z) ? z : null;
  };
  const lift = (i: number, j: number): Vec3 => {
    if (!scale) return NO_LIFT;
    const fx = gridSlope(trace.x, (n) => zAt(n, j), i) * scale[2] / scale[0];
    const fy = gridSlope(trace.y, (n) => zAt(i, n), j) * scale[2] / scale[1];
    return liftOf([-fx, -fy, 1], scale);
  };
  const line = (count: number, at: (n: number) => [number, number]): void => {
    let run = 0;
    for (let n = 0; n < count; n++) {
      const [i, j] = at(n);
      const z = zAt(i, j);
      if (z === null) {
        if (run > 0) pushBreak(wire);
        run = 0;
        continue;
      }
      pushPoint(wire, [trace.x[i]!, trace.y[j]!, z], lift(i, j));
      if (run > 0) wire.segments++;
      run++;
    }
    if (run > 0) pushBreak(wire);
  };
  for (let j = 0; j < trace.y.length; j++) line(trace.x.length, (i) => [i, j]);
  for (let i = 0; i < trace.x.length; i++) line(trace.y.length, (j) => [i, j]);
  return wire;
}

/** A mesh's vertex normals (face normals in scene-cube units, summed by area) as lifts, or none without `scale`. */
function meshLifts(trace: PlotMeshTrace, scale: Vec3 | null): Vec3[] | null {
  if (!scale) return null;
  const sums: Vec3[] = trace.vertices.map(() => [0, 0, 0]);
  for (const face of trace.faces) {
    const [a, b, c] = face.map((n) => trace.vertices[n]);
    if (!a || !b || !c) continue;
    const u = [0, 1, 2].map((k) => (b[k]! - a[k]!) * scale[k]!) as Vec3;
    const w = [0, 1, 2].map((k) => (c[k]! - a[k]!) * scale[k]!) as Vec3;
    const cross: Vec3 = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const n of face) {
      const sum = sums[n];
      if (sum) { sum[0] += cross[0]; sum[1] += cross[1]; sum[2] += cross[2]; }
    }
  }
  return sums.map((sum) => liftOf(sum, scale));
}

/**
 * A mesh's edges as one polyline of null-separated segments, each shared edge once. Two consecutive faces [a,b,c], [a,c,d] are
 * one quad fanned from a (how Mathematica's Plot3D and matplotlib's plot_surface split a grid cell): their diagonal a–c is dropped
 * so the wire shows the grid, not the triangles. Lifted along the vertex normals when `scale` is given.
 */
function meshWire(trace: PlotMeshTrace, scale: Vec3 | null): Wire {
  const wire: Wire = { x: [], y: [], z: [], lift: [], segments: 0 };
  const count = trace.vertices.length;
  const lifts = meshLifts(trace, scale);
  const seen = new Set<number>();
  const edge = (p: number, q: number): void => {
    if (p === q) return;
    const key = Math.min(p, q) * count + Math.max(p, q);
    if (seen.has(key)) return;
    seen.add(key);
    const a = trace.vertices[p];
    const b = trace.vertices[q];
    if (!a || !b) return;
    pushPoint(wire, a, lifts?.[p] ?? NO_LIFT);
    pushPoint(wire, b, lifts?.[q] ?? NO_LIFT);
    pushBreak(wire);
    wire.segments++;
  };
  const faces = trace.faces;
  for (let n = 0; n < faces.length; n++) {
    const [a, b, c] = faces[n]!;
    const next = faces[n + 1];
    if (next && next[0] === a && next[1] === c) {
      const d = next[2];
      edge(a, b); edge(b, c); edge(c, d); edge(d, a);
      n++;
      continue;
    }
    edge(a, b); edge(b, c); edge(c, a);
  }
  return wire;
}

/**
 * The wires of a spec's surfaces and meshes by trace index, lifted off their surfaces when `scale` is given, or null when they
 * hold more than PLOT_WIREFRAME_SEGMENTS segments.
 */
export function plotWires(spec: PlotSpec, scale: Vec3 | null): Map<number, Wire> | null {
  const wires = new Map<number, Wire>();
  let segments = 0;
  for (const [i, trace] of spec.traces.entries()) {
    if (trace.type !== "surface" && trace.type !== "mesh") continue;
    const wire = trace.type === "surface" ? surfaceWire(trace, scale) : meshWire(trace, scale);
    segments += wire.segments;
    if (segments > PLOT_WIREFRAME_SEGMENTS) return null;
    wires.set(i, wire);
  }
  return wires;
}

/** True when a 3D spec's surfaces and meshes fit a wireframe; false for a spec with none or with too many edges. */
export function plotWireframeFits(spec: PlotSpec): boolean {
  return hasPlotSurfaces(spec) && plotWires(spec, null) !== null;
}

/** The lowest and highest finite z over a spec's surfaces and meshes, the ends of its height colour scale; null when it has none. */
export function heightRange(spec: PlotSpec): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const add = (z: PlotValue | undefined): void => {
    if (!finiteNumber(z)) return;
    lo = Math.min(lo, z);
    hi = Math.max(hi, z);
  };
  for (const trace of spec.traces) {
    if (trace.type === "surface") for (const row of trace.z) for (const z of row) add(z);
    else if (trace.type === "mesh") for (const v of trace.vertices) add(v[2]);
  }
  return lo <= hi ? [lo, hi] : null;
}
