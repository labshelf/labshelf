// The Plotly figure of a plot or data figure: one panel draws as its chart does; several panels share one Plotly figure,
// each in its own band (side by side or stacked) with its own pair of axes or its own 3D scene. DOM-free.
// CONTRACT: documents/contracts/qmd-items.md#figures
import { chartFigure, type ChartFigure } from './figure.js';
import { panelCharts, type FigureModel } from './figureModel.js';
import type { ChartTable, ChartTheme } from './model.js';

/** The space left between two panels, as a fraction of the figure. */
const GAP = 0.06;

/** The [from, to] band of panel `index` of `count` along one direction. */
function band(index: number, count: number): [number, number] {
  const size = (1 - GAP * (count - 1)) / count;
  const from = index * (size + GAP);
  return [from, from + size];
}

/** Moves one panel's figure into its band: its axes become xaxis<k> and yaxis<k> (or its scene scene<k>) and its traces point at them. */
function placePanel(panel: ChartFigure, index: number, count: number, arrange: 'row' | 'column', layout: Record<string, unknown>): Record<string, unknown>[] {
  const k = index === 0 ? '' : String(index + 1);
  const along = band(index, count);
  const x: [number, number] = arrange === 'row' ? along : [0, 1];
  const y: [number, number] = arrange === 'row' ? [0, 1] : [1 - along[1], 1 - along[0]];
  if (panel.layout.scene !== undefined) {
    layout[`scene${k}`] = { ...(panel.layout.scene as Record<string, unknown>), domain: { x, y } };
    return panel.data.map((trace) => ({ ...trace, scene: `scene${k}` }));
  }
  layout[`xaxis${k}`] = { ...(panel.layout.xaxis as Record<string, unknown>), domain: x, anchor: `y${k}` };
  layout[`yaxis${k}`] = { ...(panel.layout.yaxis as Record<string, unknown>), domain: y, anchor: `x${k}` };
  return panel.data.map((trace) => ({ ...trace, xaxis: `x${k}`, yaxis: `y${k}` }));
}

/** The figure of a plot or data figure, its data columns read from `table`; empty for a drawing. */
export function figurePlotly(figure: FigureModel, table: ChartTable | null, theme: ChartTheme): ChartFigure {
  const panels = panelCharts(figure).map((chart) => chartFigure({ ...chart, ...(figure.title !== undefined ? { title: figure.title } : {}) }, table, theme));
  if (panels.length <= 1) { return panels[0] ?? { data: [], layout: {} }; }
  const { scene: _scene, xaxis: _x, yaxis: _y, ...base } = panels[0]!.layout;
  const layout: Record<string, unknown> = { ...base };
  const data = panels.flatMap((panel, i) => placePanel(panel, i, panels.length, figure.arrange ?? 'row', layout));
  return { data, layout };
}
