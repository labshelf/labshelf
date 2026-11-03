// A Plotly view on the workspace stage: drawn at most once per frame, with the drag mode (select by zoom box or pan), zoom
// steps and fit acting on the drawn axes (view state only), the point a click lands on, and the camera a 3D drag leaves.
import { renderElement } from "../../../ui/dom/index.js";
import type { ChartFigure, ChartLayout } from "../../chart/index.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";
import { createPlotDrawer, drawnRange, scaled, watchCamera, ZOOM_FACTOR } from "./preview.js";

type Listener = (event: Readonly<Record<string, unknown>>) => void;

export interface StagePlotOptions {
  /** A click on a point: the index of its trace in the figure and of the point in the trace. */
  onPoint?(trace: number, index: number): void;
  onCamera?(camera: NonNullable<ChartLayout["camera"]>): void;
}

export interface StagePlot {
  element: HTMLElement;
  draw(figure: ChartFigure): void;
  setDrag(mode: "zoom" | "pan"): void;
  zoom(step: 1 | -1, axes?: { x: string; y: string }): void;
  fit(): void;
  destroy(): void;
}

/** The first point of a plotly_click event, or null. */
function pointOf(event: Readonly<Record<string, unknown>>): { trace: number; index: number } | null {
  const point = (event.points as { curveNumber?: unknown; pointNumber?: unknown; pointIndex?: unknown }[] | undefined)?.[0];
  const index = point?.pointIndex ?? point?.pointNumber;
  return typeof point?.curveNumber === "number" && typeof index === "number" ? { trace: point.curveNumber, index } : null;
}

/** Mounts the plot in `root`; `draw` queues a figure, the drag mode applies to every later draw. */
export function mountStagePlot(root: HTMLElement, loadPlotly: EditorPlotlyLoader, options: StagePlotOptions = {}): StagePlot {
  const plot = renderElement("div", { class: "fe-plot" });
  const element = renderElement("div", { class: "fe-plot-box" }, plot);
  let drag: "zoom" | "pan" = "zoom";
  let unwatch: (() => void) | null = null;
  const watch = (): void => {
    const events = plot as HTMLElement & { on?: (name: string, listener: Listener) => void; removeListener?: (name: string, listener: Listener) => void };
    if (unwatch !== null || typeof events.on !== "function") return;
    const click: Listener = (event) => { const point = pointOf(event); if (point) options.onPoint?.(point.trace, point.index); };
    events.on("plotly_click", click);
    const camera = options.onCamera ? watchCamera(plot, options.onCamera) : null;
    unwatch = () => { events.removeListener?.("plotly_click", click); camera?.(); };
  };
  const drawer = createPlotDrawer(plot, element, loadPlotly, watch);
  root.append(element);
  return {
    element,
    draw: (figure) => drawer.draw({ data: figure.data, layout: { ...figure.layout, dragmode: drag } }),
    setDrag(mode) { drag = mode; drawer.relayout({ dragmode: mode }); },
    zoom(step, axes = { x: "xaxis", y: "yaxis" }) {
      const x = drawnRange(plot, axes.x);
      const y = drawnRange(plot, axes.y);
      if (x === null || y === null) return;
      const factor = step === 1 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
      drawer.relayout({ [`${axes.x}.range`]: scaled(x, factor), [`${axes.y}.range`]: scaled(y, factor) });
    },
    fit: () => drawer.relayout({ "xaxis.autorange": true, "yaxis.autorange": true }),
    destroy() { unwatch?.(); unwatch = null; drawer.destroy(); },
  };
}
