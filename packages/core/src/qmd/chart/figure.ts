// The Plotly figure of a chart model: its traces read from the chart's table by column letter, coloured from the page palette, and its layout from the model's axes, legend and title. DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#charts
import type { ChartAxis, ChartKind, ChartModel, ChartTable, ChartTrace } from "./model.js";

export interface ChartFigure { data: Record<string, unknown>[]; layout: Record<string, unknown> }

/** The page colours a chart takes: text, quiet text, hairlines, font family and the trace palette. */
export interface ChartTheme { fg: string; muted: string; grid: string; font: string; palette: readonly string[] }

type Column = (number | string | null)[];

const KIND_LABELS: Record<ChartKind, string> = { data: "Data", fn2d: "Function", fn3d: "3D function" };

/** The name a chart of this kind goes by when it has no title: Data, Function or 3D function. */
export function chartKindLabel(kind: ChartKind): string {
  return KIND_LABELS[kind];
}

/** The index of a spreadsheet column letter (A is 0, Z is 25, AA is 26); -1 for anything else. */
function columnIndex(letter: string): number {
  if (!/^[A-Z]+$/.test(letter)) return -1;
  let index = 0;
  for (const char of letter) index = index * 26 + (char.charCodeAt(0) - 64);
  return index - 1;
}

function columnOf(table: ChartTable, letter: string | undefined): Column {
  if (letter === undefined) return [];
  return [...(table.cols[columnIndex(letter)]?.values ?? [])];
}

/** The fields every trace shares: its name, opacity and legend entry when the model sets them. */
function common(trace: ChartTrace): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (trace.name !== undefined) out.name = trace.name;
  if (trace.opacity !== undefined) out.opacity = trace.opacity;
  if (trace.showlegend !== undefined) out.showlegend = trace.showlegend;
  return out;
}

/** One Plotly trace, or null for a trace type not drawn yet. */
function toTrace(trace: ChartTrace, table: ChartTable, color: string, palette: readonly string[]): Record<string, unknown> | null {
  const x = columnOf(table, trace.x);
  const y = columnOf(table, trace.y);
  switch (trace.type) {
    case "scatter": {
      const out: Record<string, unknown> = { type: "scatter", ...common(trace), x, y, mode: trace.mode ?? "lines", line: { color }, marker: { color } };
      if (trace.fill !== undefined) out.fill = trace.fill;
      return out;
    }
    case "bar":
      return { type: "bar", ...common(trace), x, y, marker: { color } };
    case "pie":
      return { type: "pie", ...common(trace), labels: x, values: y, marker: { colors: x.map((_, i) => palette[i % palette.length]!) }, sort: false };
    default:
      return null;
  }
}

/** The traces of a data chart; empty for a function chart, without a table, or when any trace is of a type not drawn yet. */
function chartTraces(model: ChartModel, table: ChartTable | null, palette: readonly string[]): Record<string, unknown>[] {
  if (model.kind !== "data" || table === null) return [];
  const out: Record<string, unknown>[] = [];
  for (const [i, trace] of model.traces.entries()) {
    const drawn = toTrace(trace, table, trace.color ?? palette[i % palette.length] ?? "#808080", palette);
    if (drawn === null) return [];
    out.push(drawn);
  }
  return out;
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

function toLayout(model: ChartModel, theme: ChartTheme): Record<string, unknown> {
  const { layout } = model;
  const legend: Record<string, unknown> = { font: { family: theme.font, color: theme.muted } };
  if (layout.legend.x !== undefined) legend.x = layout.legend.x;
  if (layout.legend.y !== undefined) legend.y = layout.legend.y;
  if (layout.legend.orientation !== undefined) legend.orientation = layout.legend.orientation;
  const out: Record<string, unknown> = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor: "rgba(0,0,0,0)",
    font: { color: theme.fg, family: theme.font },
    margin: { l: 8, r: 8, t: model.title === undefined ? 8 : 40, b: 8, pad: 0 },
    showlegend: layout.legend.show,
    legend,
    xaxis: toAxis(layout.xaxis, theme),
    yaxis: toAxis(layout.yaxis, theme),
    hovermode: "closest",
  };
  if (model.title !== undefined) out.title = { text: model.title, x: 0, xanchor: "left", font: { family: theme.font, color: theme.fg } };
  if (layout.width !== undefined) out.width = layout.width;
  if (layout.height !== undefined) out.height = layout.height;
  return out;
}

/** The Plotly figure of a chart, its columns read from `table` (the model's own or one loaded from its src). Scatter (lines, markers, area fill), bar and pie draw; other trace types and function charts give no traces yet. */
export function chartFigure(model: import('./model.js').ChartModel, table: import('./model.js').ChartTable | null, theme: { fg: string; muted: string; grid: string; font: string; palette: readonly string[] }): ChartFigure {
  return { data: chartTraces(model, table, theme.palette), layout: toLayout(model, theme) };
}
