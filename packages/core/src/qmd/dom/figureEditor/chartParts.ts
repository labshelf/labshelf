// The parts a plot or data figure stores besides its model: the PNG Plotly draws into a detached element at a fixed size on a
// white page (read back through Plotly.toImage, then purged), the pgfplots picture of a one-panel figure, and a large table
// written to assets/<id>.csv before the block (plan charts, D4/D5), so a block never points at a file that was not written.
import { EXPORT_THEME, figureKindLabel, figurePlotly, formatChartPgf, panelCharts, placeTable, type ChartFigure, type ChartTable, type FigureModel, type FigurePng } from "../../chart/index.js";
import type { EditorPlotly, EditorPlotlyLoader } from "./editorPlotly.js";
import type { FigureEditorFiles } from "./index.js";

/** The width the exported PNG is placed at in the note (plan charts, D6). */
const PNG_WIDTH_CM = 16;
const DEFAULT_SIZE = { widthPx: 640, heightPx: 400 };
const SCALE = 2;
const PAPER = "#ffffff";
const CONFIG = { displaylogo: false, displayModeBar: false, staticPlot: true };

export const figureAlt = (model: FigureModel): string => model.title?.trim() || figureKindLabel(model.kind);

/** The PNG data URL of `figure` drawn at `size` (640x400 px by default) and scale 2; null when Plotly cannot draw or export it. */
export async function exportChartPng(plotly: EditorPlotly, figure: ChartFigure, size?: { widthPx: number; heightPx: number }): Promise<string | null> {
  const { widthPx, heightPx } = size ?? DEFAULT_SIZE;
  const root = document.createElement("div");
  root.className = "qmd-chart-export";
  const layout = { ...figure.layout, width: widthPx, height: heightPx, autosize: false, paper_bgcolor: PAPER, plot_bgcolor: PAPER };
  try {
    await plotly.react(root, figure.data, layout, CONFIG);
    return await plotly.toImage(root, { format: "png", width: widthPx, height: heightPx, scale: SCALE });
  } catch {
    return null;
  } finally {
    try { plotly.purge(root); } catch { /* the detached element goes with this call */ }
  }
}

/** The figure's PNG, or null when Plotly does not load or cannot export it; a figure of several side-by-side panels is drawn wider. */
async function takePng(loadPlotly: EditorPlotlyLoader, model: FigureModel, table: ChartTable | null): Promise<FigurePng | null> {
  try {
    const plotly = await loadPlotly();
    const panels = model.kind === "plot" ? model.panels?.length ?? 1 : 1;
    const wide = model.arrange !== "column" && panels > 1;
    const size = wide ? { widthPx: DEFAULT_SIZE.widthPx * panels, heightPx: DEFAULT_SIZE.heightPx } : model.arrange === "column" && panels > 1 ? { widthPx: DEFAULT_SIZE.widthPx, heightPx: DEFAULT_SIZE.heightPx * panels } : undefined;
    const dataUrl = await exportChartPng(plotly, figurePlotly(model, table, EXPORT_THEME), size);
    return dataUrl === null ? null : { dataUrl, widthCm: PNG_WIDTH_CM, alt: figureAlt(model) };
  } catch {
    return null;
  }
}

/** The pgfplots picture of a figure with one chart to draw (a one-panel plot or a data figure), when pgfplots can draw it. */
export function figurePgf(model: FigureModel, table: ChartTable | null): string | null {
  const charts = panelCharts(model);
  return charts.length === 1 ? formatChartPgf(charts[0]!, table) : null;
}

/** The model to write with `table` placed; a large table is written to its CSV first, and stays inline without `files` or when it follows a document table. A failed write gives its message and no model. */
export async function commitChart(model: FigureModel, table: ChartTable, files: FigureEditorFiles | undefined): Promise<{ model: FigureModel; error: null } | { model: null; error: string }> {
  if (files === undefined || model.table !== undefined) {
    const { src: _src, ...rest } = model;
    return { model: { ...rest, data: table }, error: null };
  }
  const placed = placeTable({ ...model, kind: "data" }, table);
  const stored: FigureModel = { ...placed.model, kind: model.kind };
  if (placed.csv === null) return { model: stored, error: null };
  try {
    await files.write(placed.csv.path, new TextEncoder().encode(placed.csv.text));
  } catch (error) {
    return { model: null, error: error instanceof Error ? error.message : String(error) };
  }
  return { model: stored, error: null };
}

/** The PNG and pgfplots picture of a plot or data figure drawn from `table`. */
export async function chartFigureParts(loadPlotly: EditorPlotlyLoader, model: FigureModel, table: ChartTable | null): Promise<{ png: FigurePng | null; picture: string | null; svg: null }> {
  return { png: await takePng(loadPlotly, model, table), picture: figurePgf(model, table), svg: null };
}
