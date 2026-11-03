// The Plotly figure of a chart model: the traces of a data chart (see traces.ts), the traces of a 2D or 3D function chart (see sample2d.ts, sample3d.ts) and the layout from the model's axes, legend, font, bar mode, 3D scene and title. DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#charts
import type { ChartAxis, ChartKind, ChartModel, ChartTable, ChartTheme } from "./model.js";
import { fnTraces2d } from "./sample2d.js";
import { fnTraces3d } from "./sample3d.js";
import { traceData } from "./traces.js";

export interface ChartFigure { data: Record<string, unknown>[]; layout: Record<string, unknown> }

const KIND_LABELS: Record<ChartKind, string> = { data: "Data", fn2d: "Function", fn3d: "3D function" };

/** The name a chart of this kind goes by when it has no title: Data, Function or 3D function. */
export function chartKindLabel(kind: ChartKind): string {
  return KIND_LABELS[kind];
}

/** The Plotly figure of a chart, its columns read from `table` (the model's own or one loaded from its src). Every data trace type draws (scatter, bar, pie, heatmap, contour, surface, scatter3d, mesh3d, histogram, box); 2D function charts draw their functions (y = f(x), x = f(y), relations, parametric, polar, implicit); 3D function charts draw their functions (z = f(x, y), parametric surfaces, curves) in a 3D scene. */
export function chartFigure(model: ChartModel, table: ChartTable | null, theme: ChartTheme): ChartFigure {
  return { data: chartTraces(model, table, theme.palette), layout: chartLayout(model, theme) };
}

const DEFAULT_VIEW: [number, number] = [-10, 10];

/** The traces of a chart: for a 2D function chart those of each visible function (its colour or the palette's, over the axes' ranges, default -10 to 10); for a data chart those of its table, each with the layout's colourscale when it has none of its own; for a 3D function chart those of each visible function (surface, parametric surface or curve, with the layout's colourscale, default Viridis). Empty for a data chart without a table. */
export function chartTraces(model: ChartModel, table: ChartTable | null, palette: readonly string[]): Record<string, unknown>[] {
  if (model.kind === "fn2d") {
    const view = { x: model.layout.xaxis.range ?? DEFAULT_VIEW, y: model.layout.yaxis.range ?? DEFAULT_VIEW };
    return model.fns.flatMap((fn, i) => (fn.hidden === true ? [] : fnTraces2d(fn, model.vars, view, fn.color ?? palette[i % palette.length] ?? "#888888").traces));
  }
  if (model.kind === "fn3d") {
    return model.fns.flatMap((fn) => (fn.hidden === true ? [] : fnTraces3d(fn, model.vars, model.layout.colorscale ?? "Viridis").traces));
  }
  if (model.kind !== "data" || table === null) return [];
  const scale = model.layout.colorscale;
  return model.traces.flatMap((trace, i) => (trace.hidden === true ? [] : traceData(scale !== undefined && trace.colorscale === undefined ? { ...trace, colorscale: scale } : trace, table, palette, i)));
}

function toAxis(axis: ChartAxis, theme: ChartTheme): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: axis.type,
    color: theme.muted,
    gridcolor: theme.grid,
    zerolinecolor: theme.grid,
    showgrid: axis.grid !== false,
    automargin: true,
  };
  const title = axis.unit === undefined ? axis.title : `${axis.title ?? ""} (${axis.unit})`.trim();
  if (title !== undefined) out.title = { text: title, font: { color: theme.muted, family: theme.font } };
  if (axis.range !== undefined) {
    // The model holds a range in data units; Plotly reads a log axis range as log10 values, and a bound <= 0 has no log (left to autorange).
    if (axis.type !== "log") out.range = [...axis.range];
    else if (axis.range[0] > 0 && axis.range[1] > 0) out.range = [Math.log10(axis.range[0]), Math.log10(axis.range[1])];
  }
  if (axis.ticks !== undefined) out.nticks = axis.ticks;
  return out;
}

const SCENE_TYPES: readonly string[] = ["surface", "scatter3d", "mesh3d"];

export function chartLayout(model: ChartModel, theme: ChartTheme): Record<string, unknown> {
  const { layout } = model;
  const legend: Record<string, unknown> = { font: { family: theme.font, color: theme.muted } };
  if (layout.legend.x !== undefined) legend.x = layout.legend.x;
  if (layout.legend.y !== undefined) legend.y = layout.legend.y;
  if (layout.legend.orientation !== undefined) legend.orientation = layout.legend.orientation;
  const font: Record<string, unknown> = { color: theme.fg, family: theme.font };
  if (layout.fontSize !== undefined) font.size = layout.fontSize;
  const out: Record<string, unknown> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font,
    margin: { l: 8, r: 8, t: model.title === undefined ? 8 : 40, b: 8, pad: 0 },
    showlegend: layout.legend.show,
    legend,
    hovermode: "closest",
  };
  if (model.kind === "fn3d" || model.traces.some((trace) => SCENE_TYPES.includes(trace.type))) {
    const scene: Record<string, unknown> = { xaxis: toAxis(layout.xaxis, theme), yaxis: toAxis(layout.yaxis, theme), zaxis: toAxis(layout.zaxis ?? { type: "linear" }, theme) };
    if (layout.camera !== undefined) scene.camera = layout.camera;
    out.scene = scene;
  } else {
    out.xaxis = toAxis(layout.xaxis, theme);
    out.yaxis = toAxis(layout.yaxis, theme);
  }
  if (layout.barmode !== undefined) out.barmode = layout.barmode;
  if (model.title !== undefined) out.title = { text: model.title, x: 0, xanchor: "left", font: { family: theme.font, color: theme.fg } };
  if (layout.width !== undefined) out.width = layout.width;
  if (layout.height !== undefined) out.height = layout.height;
  return out;
}
