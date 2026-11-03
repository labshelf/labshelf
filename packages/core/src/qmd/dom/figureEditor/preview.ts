// What the figure editor's Plotly views share: a drawer that redraws through Plotly.react at most once per animation frame,
// the drawn axis ranges and the zoom step that act on them (view state, never the model), and the camera a 3D drag leaves.
// The camera (D13) is read from a plotly_relayout event, rounded to 4 decimals as the model stores it, through a subscription to
// those events on the plot div (Plotly adds `on` to the div when it draws).
import { isNumber } from "../../../guards/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import type { ChartFigure, ChartLayout, ChartVec3 } from "../../chart/index.js";
import type { EditorPlotly, EditorPlotlyLoader } from "./editorPlotly.js";

type Camera = NonNullable<ChartLayout["camera"]>;
type RelayoutListener = (event: Readonly<Record<string, unknown>>) => void;

interface PlotEvents {
  on(name: string, listener: RelayoutListener): void;
  removeListener?(name: string, listener: RelayoutListener): void;
}

/** A number rounded to 4 decimals, with -0 written as 0. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4 + 0;
}

function vec3(value: unknown): ChartVec3 | null {
  if (typeof value !== "object" || value === null) return null;
  const { x, y, z } = value as Record<string, unknown>;
  return isNumber(x) && isNumber(y) && isNumber(z) ? { x: round4(x), y: round4(y), z: round4(z) } : null;
}

/** The 'scene.camera' of a plotly_relayout event with every number rounded to 4 decimals, or null when the event has no valid one. */
export function cameraOfRelayout(event: Readonly<Record<string, unknown>>): ChartLayout["camera"] | null {
  const raw = event["scene.camera"];
  if (typeof raw !== "object" || raw === null) return null;
  const { eye, center, up } = raw as Record<string, unknown>;
  const e = vec3(eye);
  if (e === null) return null;
  const camera: Camera = { eye: e };
  const c = vec3(center);
  if (c !== null) camera.center = c;
  const u = vec3(up);
  if (u !== null) camera.up = u;
  return camera;
}

/** Calls `onCamera` for each plotly_relayout event of `plot` that carries a camera; nothing is subscribed while the div has no `on`. Returns the unsubscribe. */
export function watchCamera(plot: HTMLElement, onCamera: (camera: NonNullable<ChartLayout["camera"]>) => void): () => void {
  const events = plot as HTMLElement & Partial<PlotEvents>;
  if (typeof events.on !== "function") return () => undefined;
  const listener: RelayoutListener = (event) => {
    const camera = cameraOfRelayout(event ?? {});
    if (camera !== null && camera !== undefined) onCamera(camera);
  };
  events.on("plotly_relayout", listener);
  return () => { if (typeof events.removeListener === "function") events.removeListener("plotly_relayout", listener); };
}

const PREVIEW_CONFIG = { displaylogo: false, responsive: true, displayModeBar: false, scrollZoom: false, doubleClick: false };
/** How much one zoom step narrows (in) or widens (out) each axis range. */
export const ZOOM_FACTOR = 0.8;

type Range = [number, number];

function numericRange(value: unknown): Range | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [lo, hi] = value as unknown[];
  return typeof lo === "number" && typeof hi === "number" && Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** The range an axis has after Plotly laid the figure out, read from the element it drew into. */
export function drawnRange(plot: HTMLElement, axis: string): Range | null {
  const full = (plot as unknown as { _fullLayout?: Record<string, { range?: unknown } | undefined> })._fullLayout;
  return numericRange(full?.[axis]?.range);
}

export function scaled([lo, hi]: Range, factor: number): Range {
  const mid = (lo + hi) / 2;
  const half = ((hi - lo) / 2) * factor;
  return [mid - half, mid + half];
}

function showError(box: HTMLElement, error: unknown): void {
  box.replaceChildren(renderElement("div", { class: "qmd-chart-editor-error", text: error instanceof Error ? error.message : String(error) }));
}

export interface PlotDrawer { draw(figure: ChartFigure): void; relayout(update: Record<string, unknown>): void; destroy(): void }

/** Draws figures into `plot` through Plotly.react at most once per animation frame (the last figure of a frame wins); a failure replaces `box` with its message. `onDrawn` runs after each draw resolves. */
export function createPlotDrawer(plot: HTMLElement, box: HTMLElement, loadPlotly: EditorPlotlyLoader, onDrawn?: () => void): PlotDrawer {
  let api: EditorPlotly | null = null;
  let loading = false;
  let pending: ChartFigure | null = null;
  let frame = 0;
  let drawn = false;
  let destroyed = false;
  const fail = (error: unknown): void => { if (!destroyed) showError(box, error); };
  const flush = (): void => {
    frame = 0;
    if (destroyed || api === null || pending === null) return;
    const figure = pending;
    pending = null;
    drawn = true;
    api.react(plot, figure.data, { ...figure.layout }, PREVIEW_CONFIG).then(() => { if (!destroyed) onDrawn?.(); }, fail);
  };
  const schedule = (): void => {
    if (frame !== 0 || destroyed) return;
    frame = requestAnimationFrame(flush);
  };
  const load = (): void => {
    if (loading) return;
    loading = true;
    loadPlotly().then((loaded) => { if (destroyed) return; api = loaded; if (pending !== null) schedule(); }, fail);
  };
  const relayout = (update: Record<string, unknown>): void => {
    if (destroyed || api === null || !drawn) return;
    api.relayout(plot, update).catch(() => undefined);
  };
  return {
    draw(figure) { if (destroyed) return; pending = figure; load(); schedule(); },
    relayout,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      pending = null;
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
      api?.purge(plot);
      box.remove();
    },
  };
}
