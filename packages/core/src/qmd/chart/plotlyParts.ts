// The Plotly parts of a chart figure: the traces of a data chart (see traces.ts) and the layout from the model's axes, legend, font, bar mode, 3D scene and title. DOM-free.
import type { ChartAxis, ChartModel, ChartTheme, ChartTable } from "./model.js";
import { traceData } from "./traces.js";

/** The traces of a data chart, each with the layout's colourscale when it has none of its own; empty for a function chart or without a table. */
export function chartTraces(model: ChartModel, table: ChartTable | null, palette: readonly string[]): Record<string, unknown>[] {
  if (model.kind !== "data" || table === null) return [];
  const scale = model.layout.colorscale;
  return model.traces.flatMap((trace, i) => traceData(scale !== undefined && trace.colorscale === undefined ? { ...trace, colorscale: scale } : trace, table, palette, i));
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
  if (axis.title !== undefined) out.title = { text: axis.title, font: { color: theme.muted, family: theme.font } };
  if (axis.range !== undefined) out.range = [...axis.range];
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
  if (model.traces.some((trace) => SCENE_TYPES.includes(trace.type))) {
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
