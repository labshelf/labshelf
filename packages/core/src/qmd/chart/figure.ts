// The Plotly figure of a chart model: its traces read from the chart's table by column letter, coloured from the page palette, and its layout from the model's axes, legend and title. DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#charts
import type { ChartKind, ChartModel, ChartTable, ChartTheme } from "./model.js";
import { chartLayout, chartTraces } from "./plotlyParts.js";

export interface ChartFigure { data: Record<string, unknown>[]; layout: Record<string, unknown> }

const KIND_LABELS: Record<ChartKind, string> = { data: "Data", fn2d: "Function", fn3d: "3D function" };

/** The name a chart of this kind goes by when it has no title: Data, Function or 3D function. */
export function chartKindLabel(kind: ChartKind): string {
  return KIND_LABELS[kind];
}

/** The Plotly figure of a chart, its columns read from `table` (the model's own or one loaded from its src). Scatter (lines, markers, area fill), bar and pie draw; other trace types and function charts give no traces yet. */
export function chartFigure(model: ChartModel, table: ChartTable | null, theme: ChartTheme): ChartFigure {
  return { data: chartTraces(model, table, theme.palette), layout: chartLayout(model, theme) };
}
