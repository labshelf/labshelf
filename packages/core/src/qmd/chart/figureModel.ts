// The labshelf-figure v1 model, the one figure a note holds: a drawing (points and items that become TikZ), a plot (functions
// and parameters over one or more 2D or 3D panels) or a data figure (a table and its series). A plot is drawn panel by panel
// through the chart model of each panel (panelCharts), so sampling, Plotly figures and pgfplots stay per panel.
// CONTRACT: documents/contracts/qmd-items.md#figures
import { parseDrawingModel, type DrawingModel } from '../../drawing/index.js';
import { readChartModel, type ChartLayout, type ChartModel } from './model.js';

export type FigureKind = 'drawing' | 'plot' | 'data';

/** One panel of a plot: 2D or 3D, with its own axes, legend and camera. */
export interface FigurePanel { dims: 2 | 3; layout: ChartLayout }

/** A figure: the chart fields hold a data figure's table and series and a plot's functions and parameters; `panels` is a plot's, `drawing` a drawing's. */
export interface FigureModel extends Omit<ChartModel, 'kind'> { kind: FigureKind; panels?: FigurePanel[]; arrange?: 'row' | 'column'; drawing?: DrawingModel }

const KINDS: readonly FigureKind[] = ['drawing', 'plot', 'data'];

/** The layout of a new panel or data figure: linear axes and a shown legend, and a z axis in 3D. */
export function emptyLayout(dims: 2 | 3): ChartLayout {
  const layout: ChartLayout = { xaxis: { type: 'linear' }, yaxis: { type: 'linear' }, legend: { show: true } };
  if (dims === 3) { layout.zaxis = { type: 'linear' }; }
  return layout;
}

/** The chart of one plot panel: its functions (a function without `panel` is on panel 0) and the plot's parameters. */
function panelChart(figure: FigureModel, panel: FigurePanel, index: number): ChartModel {
  const fns = figure.fns.filter((fn) => (fn.panel ?? 0) === index);
  return { v: 1, id: figure.id, kind: panel.dims === 3 ? 'fn3d' : 'fn2d', traces: [], fns, vars: figure.vars, layout: panel.layout };
}

/** The charts a figure draws: one per plot panel, the figure itself for data, none for a drawing. */
export function panelCharts(figure: FigureModel): ChartModel[] {
  if (figure.kind === 'plot') { return (figure.panels ?? []).map((panel, i) => panelChart(figure, panel, i)); }
  if (figure.kind === 'data') { return [{ ...figure, kind: 'data' }]; }
  return [];
}

/** A figure of a stored chart (the labshelf-chart block): a function chart becomes a one-panel plot. */
export function figureOfChart(chart: ChartModel): FigureModel {
  if (chart.kind === 'data') { return { ...chart, kind: 'data' }; }
  const panels: FigurePanel[] = [{ dims: chart.kind === 'fn3d' ? 3 : 2, layout: chart.layout }];
  return { ...chart, kind: 'plot', fns: chart.fns.map(({ panel: _panel, ...fn }) => fn), panels, layout: emptyLayout(2) };
}

/** A figure of a stored drawing (the labshelf-drawing block), under the given id. */
export function figureOfDrawing(drawing: DrawingModel, id: string): FigureModel {
  return { v: 1, id, kind: 'drawing', traces: [], fns: [], vars: [], layout: emptyLayout(2), drawing };
}

function readPanels(value: unknown, id: string): FigurePanel[] | null {
  if (!Array.isArray(value) || value.length === 0) { return null; }
  const panels: FigurePanel[] = [];
  for (const item of value) {
    const dims = (item as { dims?: unknown } | null)?.dims;
    if (dims !== 2 && dims !== 3) { return null; }
    const chart = readChartModel({ v: 1, id, kind: dims === 3 ? 'fn3d' : 'fn2d', traces: [], fns: [], vars: [], layout: (item as { layout?: unknown }).layout });
    if (chart === null) { return null; }
    panels.push({ dims, layout: chart.layout });
  }
  return panels;
}

/** Validates a labshelf-figure v1 value and returns it normalised, or null; never throws. A plot needs a panel for every function. */
export function readFigureModel(json: unknown): FigureModel | null {
  if (typeof json !== 'object' || json === null) { return null; }
  const { kind, panels, arrange, drawing, ...rest } = json as Record<string, unknown>;
  if (!KINDS.includes(kind as FigureKind)) { return null; }
  const chart = readChartModel({ ...rest, kind: 'data' });
  if (chart === null) { return null; }
  const base: FigureModel = { ...chart, kind: kind as FigureKind };
  if (kind === 'plot') {
    const read = readPanels(panels, chart.id);
    if (read === null || chart.fns.some((fn) => (fn.panel ?? 0) >= read.length)) { return null; }
    return { ...base, panels: read, ...(arrange === 'row' || arrange === 'column' ? { arrange } : {}) };
  }
  if (kind === 'drawing') {
    const model = parseDrawingModel(JSON.stringify(drawing ?? null));
    return model === null ? null : { ...base, drawing: model };
  }
  return base;
}

/** A new empty figure of the kind: a drawing with nothing on it, a plot with one 2D panel, a data figure with an empty table. */
export function emptyFigure(kind: FigureKind, id: string): FigureModel {
  const base: FigureModel = { v: 1, id, kind, traces: [], fns: [], vars: [], layout: emptyLayout(2) };
  if (kind === 'plot') { return { ...base, panels: [{ dims: 2, layout: emptyLayout(2) }] }; }
  if (kind === 'drawing') { return { ...base, drawing: { v: 1, points: [], items: [] } }; }
  return { ...base, data: { cols: [] } };
}

const KIND_LABELS: Readonly<Record<FigureKind, string>> = { drawing: 'Drawing', plot: 'Function plot', data: 'Data chart' };

/** How a figure kind is named in the outline and the editor. */
export const figureKindLabel = (kind: FigureKind): string => KIND_LABELS[kind];
