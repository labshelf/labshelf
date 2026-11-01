// The visible part of a drawn plot as data: reading it from Plotly, the relayout updates that show it, and the zoom, pan, rotate
// and blend steps of the plot's navigation. Pure apart from the reads of a drawn root.
import type { PlotAxis, PlotSpec } from "../item/index.js";

/** The axis's set range in Plotly's units (log10 on a log axis), or null when it autoranges. */
export function axisRange(axis: PlotAxis | undefined): number[] | null {
  if (!axis?.range) return null;
  return axis.log === true ? [Math.log10(axis.range[0]), Math.log10(axis.range[1])] : [...axis.range];
}

/** Plotly's default 3D camera, the view a scene opens with. */
const DEFAULT_CAMERA = { eye: { x: 1.25, y: 1.25, z: 1.25 }, center: { x: 0, y: 0, z: 0 }, up: { x: 0, y: 0, z: 1 } };

/** The relayout update that returns a plot to its first view: each 2D axis to its set range or autorange, a 3D scene to the default camera. */
export function plotResetView(spec: PlotSpec): Record<string, unknown> {
  if (spec.dim === 3) return { "scene.camera": DEFAULT_CAMERA };
  const update: Record<string, unknown> = {};
  for (const name of ["x", "y"] as const) {
    const range = axisRange(spec.axes[name]);
    if (range) update[`${name}axis.range`] = range;
    else update[`${name}axis.autorange`] = true;
  }
  return update;
}

/** Which way a plot's Zoom in and Zoom out buttons go. */
export type PlotZoomDirection = "in" | "out";

/**
 * What a drag does: in 2D a pan (the default) or a box zoom; in 3D a turntable rotate (the default), a free orbit or a pan.
 */
export type PlotDragMode = "pan" | "zoom" | "turntable" | "orbit";

/** The drag a plot of `dim` dimensions opens with. */
export function defaultDragMode(dim: 2 | 3): PlotDragMode {
  return dim === 3 ? "turntable" : "pan";
}

/** The relayout update that sets the drag of a plot of `dim` dimensions. */
export function plotDragModeUpdate(dim: 2 | 3, mode: PlotDragMode): Record<string, unknown> {
  if (dim === 3) return { "scene.dragmode": mode };
  return { dragmode: mode === "zoom" ? "zoom" : "pan" };
}

/** The relayout update that fits both 2D axes to the data, ignoring the spec's own ranges. */
export const PLOT_AUTOSCALE: Readonly<Record<string, unknown>> = { "xaxis.autorange": true, "yaxis.autorange": true };

type PlotRange = [number, number];
interface PlotVec { x: number; y: number; z: number }

/** The visible part of a drawn plot: the 2D axis ranges in Plotly's units (log10 on a log axis) or the 3D camera. */
export type PlotView =
  | { dim: 2; x: PlotRange; y: PlotRange }
  | { dim: 3; eye: PlotVec; center: PlotVec; up: PlotVec };

/** The 3D view a scene opens with and Reset view returns to. */
export const DEFAULT_PLOT_VIEW_3D: PlotView = { dim: 3, ...DEFAULT_CAMERA };

const finitePair = (value: unknown): value is PlotRange =>
  Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part));

const finiteVec = (value: unknown): value is PlotVec => {
  const v = value as Partial<PlotVec> | null | undefined;
  return v != null && [v.x, v.y, v.z].every((part) => typeof part === "number" && Number.isFinite(part));
};

/** The current view of a drawn plot: the full layout Plotly keeps on its root (`_fullLayout`), or null before a draw. */
function fullLayoutOf(root: HTMLElement): Record<string, unknown> | null {
  const layout = (root as HTMLElement & { _fullLayout?: unknown })._fullLayout;
  return layout && typeof layout === "object" ? layout as Record<string, unknown> : null;
}

interface SceneLayout { camera?: { eye?: unknown; center?: unknown; up?: unknown }; _scene?: { getCamera?: () => unknown } }

/** The live view of the drawn plot on `root`, or null before a draw or when an axis has no numeric range. */
export function readPlotView(root: HTMLElement, dim: 2 | 3): PlotView | null {
  const layout = fullLayoutOf(root);
  if (!layout) return null;
  if (dim === 3) {
    const scene = layout.scene as SceneLayout | undefined;
    // The scene's own camera follows a drag at once; the layout's copy only after Plotly saves it.
    let live: SceneLayout["camera"] | undefined;
    try {
      live = scene?._scene?.getCamera?.() as SceneLayout["camera"] | undefined;
    } catch {
      live = undefined;
    }
    const camera = live ?? scene?.camera;
    const pick = (value: unknown, fallback: PlotVec): PlotVec => finiteVec(value) ? { x: value.x, y: value.y, z: value.z } : { ...fallback };
    return {
      dim: 3,
      eye: pick(camera?.eye, DEFAULT_CAMERA.eye),
      center: pick(camera?.center, DEFAULT_CAMERA.center),
      up: pick(camera?.up, DEFAULT_CAMERA.up),
    };
  }
  const x = (layout.xaxis as { range?: unknown } | undefined)?.range;
  const y = (layout.yaxis as { range?: unknown } | undefined)?.range;
  return finitePair(x) && finitePair(y) ? { dim: 2, x: [x[0], x[1]], y: [y[0], y[1]] } : null;
}

/** The plot area of a drawn 2D plot in px from the root's top-left corner, or null before a draw. */
export interface PlotArea { left: number; top: number; width: number; height: number }

export function readPlotArea(root: HTMLElement): PlotArea | null {
  const layout = fullLayoutOf(root);
  const xa = layout?.xaxis as { _offset?: unknown; _length?: unknown } | undefined;
  const ya = layout?.yaxis as { _offset?: unknown; _length?: unknown } | undefined;
  const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
  if (!xa || !ya || !num(xa._offset) || !num(xa._length) || !num(ya._offset) || !num(ya._length)) return null;
  if (xa._length <= 0 || ya._length <= 0) return null;
  return { left: xa._offset, top: ya._offset, width: xa._length, height: ya._length };
}

/** The data point (in range units) under the pixel `px`, `py` of the root, given the plot area and the 2D view. */
export function plotPointAt(view: PlotView, area: PlotArea, px: number, py: number): { x: number; y: number } | null {
  if (view.dim !== 2) return null;
  const fx = (px - area.left) / area.width;
  const fy = (py - area.top) / area.height;
  return { x: view.x[0] + fx * (view.x[1] - view.x[0]), y: view.y[1] - fy * (view.y[1] - view.y[0]) };
}

/** The relayout update that shows `view`. */
export function plotViewUpdate(view: PlotView): Record<string, unknown> {
  if (view.dim === 2) return { "xaxis.range": [...view.x], "yaxis.range": [...view.y] };
  return { "scene.camera.eye": { ...view.eye }, "scene.camera.center": { ...view.center }, "scene.camera.up": { ...view.up } };
}

/** The narrowest span a 2D zoom goes to, relative to the axis's magnitude, before floating point runs out. */
const MIN_RELATIVE_SPAN = 1e-9;
/** How close and how far a 3D zoom brings the camera to the centre of the scene. */
const MIN_EYE_DISTANCE = 0.1;
const MAX_EYE_DISTANCE = 40;

function scaleRange(range: PlotRange, anchor: number, factor: number): PlotRange {
  const next: PlotRange = [anchor + (range[0] - anchor) * factor, anchor + (range[1] - anchor) * factor];
  const span = Math.abs(next[1] - next[0]);
  const magnitude = Math.max(Math.abs(next[0]), Math.abs(next[1]), 1e-300);
  if (!next.every(Number.isFinite) || (factor < 1 && span < magnitude * MIN_RELATIVE_SPAN)) return range;
  return next;
}

/**
 * Scales the view by `factor` (below 1 zooms in): each 2D range about `anchor` (its centre when absent), or the 3D camera eye
 * toward or away from the camera centre, within limits.
 */
export function zoomPlotView(view: PlotView, factor: number, anchor?: { x: number; y: number } | null): PlotView {
  if (view.dim === 2) {
    const ax = anchor?.x ?? (view.x[0] + view.x[1]) / 2;
    const ay = anchor?.y ?? (view.y[0] + view.y[1]) / 2;
    return { dim: 2, x: scaleRange(view.x, ax, factor), y: scaleRange(view.y, ay, factor) };
  }
  const d = { x: view.eye.x - view.center.x, y: view.eye.y - view.center.y, z: view.eye.z - view.center.z };
  const distance = Math.hypot(d.x, d.y, d.z);
  if (distance === 0) return view;
  const target = Math.min(MAX_EYE_DISTANCE, Math.max(MIN_EYE_DISTANCE, distance * factor));
  const k = target / distance;
  return { ...view, eye: { x: view.center.x + d.x * k, y: view.center.y + d.y * k, z: view.center.z + d.z * k } };
}

/** Shifts a 2D view by fractions of its spans (positive moves toward larger values); a 3D view is returned as is. */
export function panPlotView(view: PlotView, fx: number, fy: number): PlotView {
  if (view.dim !== 2) return view;
  const dx = (view.x[1] - view.x[0]) * fx;
  const dy = (view.y[1] - view.y[0]) * fy;
  return { dim: 2, x: [view.x[0] + dx, view.x[1] + dx], y: [view.y[0] + dy, view.y[1] + dy] };
}

/** The highest a 3D rotate lifts the camera above (or below) the horizontal plane, short of the pole. */
const MAX_ELEVATION = Math.PI / 2 - 0.05;

/** Turns the 3D camera about the centre: `azimuth` radians around the vertical (z) axis, `elevation` radians up or down. */
export function rotatePlotView(view: PlotView, azimuth: number, elevation: number): PlotView {
  if (view.dim !== 3) return view;
  const d = { x: view.eye.x - view.center.x, y: view.eye.y - view.center.y, z: view.eye.z - view.center.z };
  const cos = Math.cos(azimuth);
  const sin = Math.sin(azimuth);
  const rx = d.x * cos - d.y * sin;
  const ry = d.x * sin + d.y * cos;
  const horizontal = Math.hypot(rx, ry);
  const distance = Math.hypot(horizontal, d.z);
  if (distance === 0) return view;
  const lifted = Math.max(-MAX_ELEVATION, Math.min(MAX_ELEVATION, Math.atan2(d.z, horizontal) + elevation));
  const nextHorizontal = distance * Math.cos(lifted);
  const ux = horizontal > 0 ? rx / horizontal : 1;
  const uy = horizontal > 0 ? ry / horizontal : 0;
  return {
    ...view,
    eye: { x: view.center.x + ux * nextHorizontal, y: view.center.y + uy * nextHorizontal, z: view.center.z + distance * Math.sin(lifted) },
  };
}

const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixVec = (a: PlotVec, b: PlotVec, t: number): PlotVec => ({ x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) });

/** The view `t` (0 to 1) of the way from `a` to `b`; `b` when their dimensions differ. */
export function blendPlotView(a: PlotView, b: PlotView, t: number): PlotView {
  if (a.dim === 2 && b.dim === 2) return { dim: 2, x: [mix(a.x[0], b.x[0], t), mix(a.x[1], b.x[1], t)], y: [mix(a.y[0], b.y[0], t), mix(a.y[1], b.y[1], t)] };
  if (a.dim === 3 && b.dim === 3) return { dim: 3, eye: mixVec(a.eye, b.eye, t), center: mixVec(a.center, b.center, t), up: mixVec(a.up, b.up, t) };
  return b;
}
