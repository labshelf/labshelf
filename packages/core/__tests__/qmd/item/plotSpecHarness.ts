// Shared builders and limits for the plotSpec tests (plotSpec.test.ts, plotSpecValues.test.ts).
import { readPlotSpec, type PlotLineTrace, type PlotSpec } from "../../../src/qmd/item/plotSpec";

// The decided limits, as literals: the seam stubs generate only functions and types.
export const PLOT_LINE_POINTS = 2000;
export const PLOT_MESH_TRIANGLES = 20000;
export const PLOT_SPEC_BYTES = 262144;

export type Json = Record<string, unknown>;

export const line2d = (extra: Json = {}): Json => ({ type: "line", x: [1, 2, 3], y: [4, 5, 6], ...extra });
export const spec2d = (over: Json = {}, trace: Json = line2d()): Json => ({
  v: 1, dim: 2, axes: { x: {}, y: {} }, traces: [trace], ...over,
});
export const surface = (rows: number, cols: number): Json => ({
  type: "surface",
  x: Array.from({ length: cols }, (_, i) => i),
  y: Array.from({ length: rows }, (_, i) => i),
  z: Array.from({ length: rows }, () => Array.from({ length: cols }, () => 1)),
});
export const mesh = (faces: number): Json => ({
  type: "mesh",
  vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
  faces: Array.from({ length: faces }, () => [0, 1, 2]),
});
export const spec3d = (trace: Json, over: Json = {}): Json => ({
  v: 1, dim: 3, axes: { x: {}, y: {}, z: {} }, traces: [trace], ...over,
});

export const must = (value: unknown): PlotSpec => {
  const spec = readPlotSpec(value);
  expect(spec).not.toBeNull();
  return spec as PlotSpec;
};
export const lineOf = (spec: PlotSpec, i = 0): PlotLineTrace => spec.traces[i] as PlotLineTrace;
export const round4 = (v: number): number => (v === 0 ? 0 : Number(v.toPrecision(4)));
