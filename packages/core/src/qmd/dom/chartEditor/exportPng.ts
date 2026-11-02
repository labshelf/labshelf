// Takes the PNG a chart block stores for paper: the figure drawn by Plotly into a detached element at a fixed size on a
// white page, read back through Plotly.toImage, then purged.
import type { ChartFigure } from "../../chart/index.js";
import type { EditorPlotly } from "./editorPlotly.js";

const DEFAULT_SIZE = { widthPx: 640, heightPx: 400 };
const SCALE = 2;
const PAPER = "#ffffff";
const CONFIG = { displaylogo: false, displayModeBar: false, staticPlot: true };

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
