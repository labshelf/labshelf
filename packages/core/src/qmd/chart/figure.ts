// The Plotly figure of a chart model: its traces (traces.ts) and its layout (plotlyParts.ts). DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#charts
import type { ChartKind, ChartModel, ChartTable, ChartTheme } from "./model.js";
import { chartLayout, chartTraces } from "./plotlyParts.js";

export interface ChartFigure { data: Record<string, unknown>[]; layout: Record<string, unknown> }

const KIND_LABELS: Record<ChartKind, string> = { data: "Data", fn2d: "Function", fn3d: "3D function" };

/** The name a chart of this kind goes by when it has no title: Data, Function or 3D function. */
export function chartKindLabel(kind: ChartKind): string {
  return KIND_LABELS[kind];
}

/** The Plotly figure of a chart, its columns read from `table` (the model's own or one loaded from its src). Every data trace type draws (scatter, bar, pie, heatmap, contour, surface, scatter3d, mesh3d, histogram, box); 2D function charts draw their functions (y = f(x), x = f(y), relations, parametric, polar, implicit); 3D function charts give no traces yet. */
export function chartFigure(model: ChartModel, table: ChartTable | null, theme: ChartTheme): ChartFigure {
  return { data: chartTraces(model, table, theme.palette), layout: chartLayout(model, theme) };
}
