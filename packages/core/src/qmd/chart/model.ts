// The labshelf-chart v1 model: a validated subset of a Plotly figure (data table or CSV src, traces, functions, variables, layout with axes, legend and 3D camera); reads it with unknown keys dropped and builds an empty chart of each kind.
// CONTRACT: documents/contracts/qmd-items.md#charts
import { isRecord } from '../../guards/index.js';

export type ChartKind = 'data' | 'fn2d' | 'fn3d';

export type ChartTraceType = 'scatter' | 'bar' | 'pie' | 'heatmap' | 'contour' | 'surface' | 'mesh3d' | 'scatter3d' | 'histogram' | 'box';

export interface ChartTable { cols: { name: string; values: (number | string | null)[] }[] }

export interface ChartTrace { type: ChartTraceType; name?: string; x?: string; y?: string; z?: string[]; mode?: string; fill?: string; transpose?: boolean; colorscale?: string; color?: string; opacity?: number; showlegend?: boolean; orientation?: 'v' | 'h'; hole?: number; lineWidth?: number; markerSize?: number }

export interface ChartFn { kind: 'y' | 'x' | 'param' | 'polar' | 'implicit' | 'surface' | 'param3d' | 'curve3d'; rel?: '=' | '<' | '>' | '<=' | '>='; expr: string[]; domain?: [number, number]; domain2?: [number, number]; steps?: number | [number, number]; color?: string; name?: string; hidden?: boolean }

export interface ChartVar { name: string; value: number; min?: number; max?: number; step?: number }

export interface ChartVec3 { x: number; y: number; z: number }

export interface ChartAxis { title?: string; type: 'linear' | 'log'; range?: [number, number]; ticks?: number; grid?: boolean }

export interface ChartLayout { xaxis: ChartAxis; yaxis: ChartAxis; zaxis?: ChartAxis; legend: { show: boolean; x?: number; y?: number; orientation?: 'v' | 'h' }; colorscale?: string; barmode?: 'group' | 'stack'; fontSize?: number; width?: number; height?: number; camera?: { eye: ChartVec3; center?: ChartVec3; up?: ChartVec3 } }

export interface ChartModel { v: 1; id: string; kind: ChartKind; title?: string; data?: ChartTable; src?: string; traces: ChartTrace[]; fns: ChartFn[]; vars: ChartVar[]; layout: ChartLayout }

/** The trace types a chart may hold, in the order of ChartTraceType. */
export const CHART_TRACE_TYPES: readonly ChartTraceType[] = ['scatter', 'bar', 'pie', 'heatmap', 'contour', 'surface', 'mesh3d', 'scatter3d', 'histogram', 'box'];

/** The colourscales a trace or layout may name; any other name is dropped on read. */
export const CHART_COLORSCALES: readonly string[] = ['Blackbody', 'Bluered', 'Blues', 'Cividis', 'Earth', 'Electric', 'Greens', 'Greys', 'Hot', 'Jet', 'Picnic', 'Portland', 'Rainbow', 'RdBu', 'Reds', 'Viridis', 'YlGnBu', 'YlOrRd'];

const MODES: readonly string[] = ['lines', 'markers', 'lines+markers'];

const KINDS: readonly ChartKind[] = ['data', 'fn2d', 'fn3d'];
const FN_KINDS: readonly ChartFn['kind'][] = ['y', 'x', 'param', 'polar', 'implicit', 'surface', 'param3d', 'curve3d'];
const RELS: readonly NonNullable<ChartFn['rel']>[] = ['=', '<', '>', '<=', '>='];
const ID = /^[0-9a-f]{8}$/;
/** A spreadsheet column letter: A..Z, then AA, AB, … */
const COLUMN = /^[A-Z]+$/;

class Invalid extends Error {}

function fail(): never {
  throw new Invalid();
}

type Obj = Record<string, unknown>;

function obj(value: unknown): Obj {
  return isRecord(value) ? value : fail();
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail();
}

function positive(value: unknown): number {
  const n = finite(value);
  return n > 0 ? n : fail();
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}

function bool(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.includes(value as T) ? (value as T) : fail();
}

function pair(value: unknown): [number, number] {
  if (!Array.isArray(value) || value.length !== 2) { fail(); }
  return [finite(value[0]), finite(value[1])];
}

function column(value: unknown): string {
  const col = str(value);
  return COLUMN.test(col) ? col : fail();
}

function round4(n: number): number {
  const r = Math.round(n * 1e4) / 1e4;
  return r === 0 ? 0 : r;
}

/** Copies `key` from `src` into `out` when it is a string in `allowed`; any other value is dropped instead of failing. */
function optKnown(out: Obj, src: Obj, key: string, allowed: readonly string[]): void {
  const value = src[key];
  if (typeof value === 'string' && allowed.includes(value)) { out[key] = value; }
}

/** Copies `key` from `src` into `out` through `read` when present; absent keys stay absent. */
function opt<T>(out: Obj, src: Obj, key: string, read: (value: unknown) => T): void {
  if (src[key] !== undefined) { out[key] = read(src[key]); }
}

/** A relative path under assets/ ending .csv, with no empty, '.' or '..' segment. */
function csvPath(value: unknown): string {
  const path = str(value);
  const segments = path.split('/');
  if (segments[0] !== 'assets' || segments.length < 2 || !path.endsWith('.csv')) { fail(); }
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\:]/.test(s))) { fail(); }
  return path;
}

function readTable(value: unknown): ChartTable {
  const v = obj(value);
  if (!Array.isArray(v.cols)) { fail(); }
  return {
    cols: v.cols.map((c) => {
      const col = obj(c);
      if (!Array.isArray(col.values)) { fail(); }
      const values = col.values.map((x) => (x === null || typeof x === 'string' ? x : finite(x)));
      return { name: str(col.name), values };
    }),
  };
}

function readTrace(value: unknown): ChartTrace {
  const v = obj(value);
  const out: Obj = { type: oneOf(v.type, CHART_TRACE_TYPES) };
  opt(out, v, 'name', str);
  opt(out, v, 'x', column);
  opt(out, v, 'y', column);
  opt(out, v, 'z', (z) => (Array.isArray(z) ? z.map(column) : fail()));
  optKnown(out, v, 'mode', MODES);
  opt(out, v, 'fill', str);
  opt(out, v, 'transpose', bool);
  optKnown(out, v, 'colorscale', CHART_COLORSCALES);
  opt(out, v, 'color', str);
  opt(out, v, 'opacity', (o) => { const n = finite(o); return n >= 0 && n <= 1 ? n : fail(); });
  opt(out, v, 'showlegend', bool);
  opt(out, v, 'orientation', (o) => oneOf(o, ['v', 'h'] as const));
  opt(out, v, 'hole', (h) => { const n = finite(h); return n >= 0 && n < 1 ? n : fail(); });
  opt(out, v, 'lineWidth', positive);
  opt(out, v, 'markerSize', positive);
  return out as unknown as ChartTrace;
}

function readSteps(value: unknown): number | [number, number] {
  const step = (s: unknown): number => { const n = positive(s); return Number.isInteger(n) ? n : fail(); };
  if (Array.isArray(value)) {
    if (value.length !== 2) { fail(); }
    return [step(value[0]), step(value[1])];
  }
  return step(value);
}

function readFn(value: unknown): ChartFn {
  const v = obj(value);
  const out: Obj = { kind: oneOf(v.kind, FN_KINDS) };
  opt(out, v, 'rel', (r) => oneOf(r, RELS));
  if (!Array.isArray(v.expr) || v.expr.length === 0) { fail(); }
  out.expr = v.expr.map(str);
  opt(out, v, 'domain', pair);
  opt(out, v, 'domain2', pair);
  opt(out, v, 'steps', readSteps);
  opt(out, v, 'color', str);
  opt(out, v, 'name', str);
  opt(out, v, 'hidden', bool);
  return out as unknown as ChartFn;
}

function readVar(value: unknown): ChartVar {
  const v = obj(value);
  const name = str(v.name);
  if (name === '') { fail(); }
  const out: Obj = { name, value: finite(v.value) };
  opt(out, v, 'min', finite);
  opt(out, v, 'max', finite);
  opt(out, v, 'step', positive);
  return out as unknown as ChartVar;
}

function readAxis(value: unknown): ChartAxis {
  const v = obj(value);
  const out: Obj = {};
  opt(out, v, 'title', str);
  out.type = oneOf(v.type, ['linear', 'log'] as const);
  opt(out, v, 'range', pair);
  opt(out, v, 'ticks', positive);
  opt(out, v, 'grid', bool);
  return out as unknown as ChartAxis;
}

function readVec3(value: unknown): ChartVec3 {
  const v = obj(value);
  return { x: round4(finite(v.x)), y: round4(finite(v.y)), z: round4(finite(v.z)) };
}

function readLayout(value: unknown): ChartLayout {
  const v = obj(value);
  const out: Obj = { xaxis: readAxis(v.xaxis), yaxis: readAxis(v.yaxis) };
  opt(out, v, 'zaxis', readAxis);
  const legend = obj(v.legend);
  const legendOut: Obj = { show: bool(legend.show) };
  opt(legendOut, legend, 'x', finite);
  opt(legendOut, legend, 'y', finite);
  opt(legendOut, legend, 'orientation', (o) => oneOf(o, ['v', 'h'] as const));
  out.legend = legendOut;
  optKnown(out, v, 'colorscale', CHART_COLORSCALES);
  opt(out, v, 'barmode', (b) => oneOf(b, ['group', 'stack'] as const));
  opt(out, v, 'fontSize', positive);
  opt(out, v, 'width', positive);
  opt(out, v, 'height', positive);
  opt(out, v, 'camera', (c) => {
    const cam = obj(c);
    const camOut: Obj = { eye: readVec3(cam.eye) };
    opt(camOut, cam, 'center', readVec3);
    opt(camOut, cam, 'up', readVec3);
    return camOut;
  });
  return out as unknown as ChartLayout;
}

/** Validates a labshelf-chart v1 value and returns it normalised (canonical key order, camera rounded to 4 decimals, unknown keys dropped), or null. Never throws. Function expressions are kept as text. */
export function readChartModel(json: unknown): ChartModel | null {
  try {
    const v = obj(json);
    if (v.v !== 1) { return null; }
    const out: Obj = { v: 1, id: ID.test(str(v.id)) ? v.id : fail(), kind: oneOf(v.kind, KINDS) };
    opt(out, v, 'title', str);
    opt(out, v, 'data', readTable);
    opt(out, v, 'src', csvPath);
    if (out.data !== undefined && out.src !== undefined) { return null; }
    if (!Array.isArray(v.traces) || !Array.isArray(v.fns) || !Array.isArray(v.vars)) { return null; }
    out.traces = v.traces.map(readTrace);
    out.fns = v.fns.map(readFn);
    out.vars = v.vars.map(readVar);
    out.layout = readLayout(v.layout);
    return out as unknown as ChartModel;
  } catch (error) {
    if (error instanceof Invalid) { return null; }
    throw error;
  }
}

/** A new valid chart of the kind with no traces, functions or variables: linear axes, a shown legend, a z axis for fn3d and an empty table for data. */
export function emptyChart(kind: ChartKind, id: string): ChartModel {
  const layout: ChartLayout = { xaxis: { type: 'linear' }, yaxis: { type: 'linear' }, legend: { show: true } };
  if (kind === 'fn3d') { layout.zaxis = { type: 'linear' }; }
  const model: ChartModel = { v: 1, id, kind, traces: [], fns: [], vars: [], layout };
  if (kind === 'data') { model.data = { cols: [] }; }
  return model;
}

/** The page colours a chart takes: text, quiet text, hairlines, font family and the trace palette. */
export interface ChartTheme { fg: string; muted: string; grid: string; font: string; palette: readonly string[] }
