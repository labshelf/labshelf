// The labshelf-plot v1 spec: the JSON a code cell's output carries so the editor can draw an interactive 2D or 3D plot; validates and normalises it (rounding, line decimation, mesh cap) and writes it on one line under a size cap.
// CONTRACT: documents/contracts/qmd-items.md#outputs

export interface PlotAxis { label?: string; log?: boolean; range?: [number, number] }

export interface PlotAxes { x: PlotAxis; y: PlotAxis; z?: PlotAxis }

export type PlotValue = number | null;

export interface PlotLineTrace { type: "line" | "points"; name?: string; color?: string; x: PlotValue[]; y: PlotValue[]; z?: PlotValue[] }

export interface PlotSurfaceTrace { type: "surface"; name?: string; color?: string; x: number[]; y: number[]; z: PlotValue[][] }

export interface PlotMeshTrace { type: "mesh"; name?: string; color?: string; vertices: [number, number, number][]; faces: [number, number, number][] }

export type PlotTrace = PlotLineTrace | PlotSurfaceTrace | PlotMeshTrace;

export interface PlotSpec { v: 1; dim: 2 | 3; title?: string; axes: PlotAxes; traces: PlotTrace[] }

/** The most points a line or points trace keeps; longer ones are decimated. */
export const PLOT_LINE_POINTS = 2000;
/** The most triangles a whole spec may hold (a mesh counts its faces, a surface 2 per grid cell). */
export const PLOT_MESH_TRIANGLES = 20000;
/** The most UTF-8 bytes a serialised spec may take. */
export const PLOT_SPEC_BYTES = 262144;

const COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round4(v: number): number {
  const r = Number(v.toPrecision(4));
  return r === 0 ? 0 : r;
}

/** A finite number rounded, or undefined when the value is not one. */
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? round4(v) : undefined;
}

function numbers(v: unknown): number[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: number[] = [];
  for (const item of v) {
    const n = num(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

function values(v: unknown): PlotValue[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: PlotValue[] = [];
  for (const item of v) {
    if (item === null) { out.push(null); continue; }
    const n = num(item);
    if (n === undefined) return undefined;
    out.push(n);
  }
  return out;
}

function readAxis(value: unknown): PlotAxis {
  const out: PlotAxis = {};
  if (!isObj(value)) return out;
  if (typeof value.label === "string") out.label = value.label;
  if (typeof value.log === "boolean") out.log = value.log;
  const r = value.range;
  if (Array.isArray(r) && r.length === 2 && typeof r[0] === "number" && typeof r[1] === "number" && Number.isFinite(r[0]) && Number.isFinite(r[1]) && r[0] < r[1]) {
    out.range = [round4(r[0]), round4(r[1])];
  }
  return out;
}

/** Keeps at most PLOT_LINE_POINTS points: per index bucket the min and max y, a null where the bucket has a gap, and always the first and last points. */
function decimate(columns: PlotValue[][], y: PlotValue[]): PlotValue[][] {
  const n = y.length;
  if (n <= PLOT_LINE_POINTS) return columns;
  const buckets = PLOT_LINE_POINTS / 2;
  const picked: number[] = [];
  const protectedIdx = new Set<number>([0, n - 1]);
  let gmin = -1;
  let gmax = -1;
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor((b * n) / buckets);
    const to = Math.floor(((b + 1) * n) / buckets);
    let lo = -1;
    let hi = -1;
    let gap = -1;
    for (let i = from; i < to; i++) {
      const v = y[i] as PlotValue;
      if (v === null) { if (gap < 0) gap = i; continue; }
      if (lo < 0 || v < (y[lo] as number)) lo = i;
      if (hi < 0 || v > (y[hi] as number)) hi = i;
    }
    if (lo >= 0 && (gmin < 0 || (y[lo] as number) < (y[gmin] as number))) gmin = lo;
    if (hi >= 0 && (gmax < 0 || (y[hi] as number) > (y[gmax] as number))) gmax = hi;
    if (gap >= 0) protectedIdx.add(gap);
    const set = new Set<number>();
    if (b === 0) set.add(0);
    if (b === buckets - 1) set.add(n - 1);
    if (lo >= 0) set.add(lo);
    if (hi >= 0) set.add(hi);
    if (gap >= 0) set.add(gap);
    for (const i of [...set].sort((a, c) => a - c)) picked.push(i);
  }
  if (gmin >= 0) protectedIdx.add(gmin);
  if (gmax >= 0) protectedIdx.add(gmax);
  let keep = picked;
  const excess = keep.length - PLOT_LINE_POINTS;
  if (excess > 0) {
    const droppable = keep.filter((i) => !protectedIdx.has(i));
    const drop = new Set<number>();
    for (let j = 0; j < excess && j < droppable.length; j++) drop.add(droppable[Math.floor((j * droppable.length) / excess)] as number);
    keep = keep.filter((i) => !drop.has(i));
  }
  return columns.map((col) => keep.map((i) => col[i] as PlotValue));
}

function readLine(t: Obj, type: "line" | "points", dim: 2 | 3): PlotLineTrace | null {
  const x = values(t.x);
  const y = values(t.y);
  if (!x || !y || x.length < 1 || x.length !== y.length) return null;
  let z: PlotValue[] | undefined;
  if (dim === 3) {
    z = values(t.z);
    if (!z || z.length !== x.length) return null;
  }
  const cols = decimate(z ? [x, y, z] : [x, y], y);
  const out: PlotLineTrace = { type, x: cols[0] as PlotValue[], y: cols[1] as PlotValue[] };
  if (z) out.z = cols[2] as PlotValue[];
  return out;
}

function readSurface(t: Obj): PlotSurfaceTrace | null {
  const x = numbers(t.x);
  const y = numbers(t.y);
  if (!x || !y || x.length < 1 || y.length < 1 || !Array.isArray(t.z) || t.z.length !== y.length) return null;
  const z: PlotValue[][] = [];
  for (const row of t.z) {
    const r = values(row);
    if (!r || r.length !== x.length) return null;
    z.push(r);
  }
  return { type: "surface", x, y, z };
}

function readMesh(t: Obj): PlotMeshTrace | null {
  if (!Array.isArray(t.vertices) || !Array.isArray(t.faces) || t.faces.length < 1) return null;
  const vertices: [number, number, number][] = [];
  for (const v of t.vertices) {
    const p = numbers(v);
    if (!p || p.length !== 3) return null;
    vertices.push([p[0] as number, p[1] as number, p[2] as number]);
  }
  const faces: [number, number, number][] = [];
  for (const f of t.faces) {
    if (!Array.isArray(f) || f.length !== 3) return null;
    for (const i of f) if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= vertices.length) return null;
    faces.push([f[0] as number, f[1] as number, f[2] as number]);
  }
  return { type: "mesh", vertices, faces };
}

function triangles(trace: PlotTrace): number {
  if (trace.type === "mesh") return trace.faces.length;
  if (trace.type === "surface") return 2 * (trace.y.length - 1) * (trace.x.length - 1);
  return 0;
}

function readTrace(value: unknown, dim: 2 | 3): PlotTrace | null {
  if (!isObj(value)) return null;
  const type = value.type;
  let data: PlotTrace | null;
  if (type === "line" || type === "points") data = readLine(value, type, dim);
  else if (type === "surface" && dim === 3) data = readSurface(value);
  else if (type === "mesh" && dim === 3) data = readMesh(value);
  else return null;
  if (!data) return null;
  // Key order: type, name, color, then the data.
  const { type: _type, ...rest } = data;
  const out: Obj = { type: data.type };
  if (typeof value.name === "string") out.name = value.name;
  if (typeof value.color === "string" && COLOR.test(value.color)) out.color = value.color;
  Object.assign(out, rest);
  return out as unknown as PlotTrace;
}

/** Validates a labshelf-plot v1 value and returns it normalised (rounded, decimated, unknown keys dropped), or null when it is malformed. Never throws. */
export function readPlotSpec(value: unknown): PlotSpec | null {
  try {
    if (!isObj(value) || value.v !== 1) return null;
    const dim = value.dim;
    if (dim !== 2 && dim !== 3) return null;
    const axesIn = value.axes;
    if (!isObj(axesIn) || !isObj(axesIn.x) || !isObj(axesIn.y)) return null;
    if (!Array.isArray(value.traces) || value.traces.length < 1) return null;
    const traces: PlotTrace[] = [];
    let tris = 0;
    for (const t of value.traces) {
      const trace = readTrace(t, dim);
      if (!trace) return null;
      tris += triangles(trace);
      if (tris > PLOT_MESH_TRIANGLES) return null;
      traces.push(trace);
    }
    const axes: PlotAxes = { x: readAxis(axesIn.x), y: readAxis(axesIn.y) };
    if (dim === 3 && isObj(axesIn.z)) axes.z = readAxis(axesIn.z);
    const out: PlotSpec = { v: 1, dim, axes, traces };
    return typeof value.title === "string" ? { v: 1, dim, title: value.title, axes, traces } : out;
  } catch {
    return null;
  }
}

/** JSON.parse then readPlotSpec; null on a parse error. */
export function parsePlotSpec(json: string): PlotSpec | null {
  try {
    return readPlotSpec(JSON.parse(json));
  } catch {
    return null;
  }
}

/** The spec as one line of JSON (keys v, dim, title, axes, traces), or null when it is malformed or over PLOT_SPEC_BYTES in UTF-8. */
export function formatPlotSpec(spec: PlotSpec): string | null {
  const normal = readPlotSpec(spec);
  if (!normal) return null;
  const text = JSON.stringify(normal);
  return new TextEncoder().encode(text).length > PLOT_SPEC_BYTES ? null : text;
}
