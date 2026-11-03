// The data mode of the figure editor: the data source and series on the left; a toolbar (select or pan, the chart type, axes,
// legend, fit); the chart on the stage over the table panel (Table and Import, + Row, the column badges of each series); the
// series inspector; a status bar. A click on a point selects its series and its row in the table.
import { askDialog, renderElement, showToast, wsButton, wsCheck, wsSegmented, wsSelect, wsToggle } from "../../../ui/dom/index.js";
import { columnLetter, EXPORT_THEME, figurePlotly, parseCsv, type ChartTable, type ChartTrace, type FigureModel } from "../../chart/index.js";
import { chartFigureParts, commitChart, figurePgf } from "./chartParts.js";
import { mountDataGrid, type ColumnBadge } from "./dataGrid.js";
import { renderDataInspector, type DataTab } from "./dataInspector.js";
import { renderDataPanels, seriesColour, tableRows, type DataPanelActions } from "./dataPanels.js";
import type { FigureMode, ModeContext } from "./modeTypes.js";
import { mountStagePlot } from "./stagePlot.js";

const IMPORT_TYPES: readonly string[] = [".csv", ".tsv", ".txt"];

/** The chart types the toolbar offers and the series each makes. */
const CHART_TYPES: readonly { id: string; label: string; patch: Partial<ChartTrace> }[] = [
  { id: "lines+markers", label: "Scatter with lines", patch: { type: "scatter", mode: "lines+markers" } },
  { id: "lines", label: "Line", patch: { type: "scatter", mode: "lines" } },
  { id: "markers", label: "Scatter", patch: { type: "scatter", mode: "markers" } },
  { id: "area", label: "Area", patch: { type: "scatter", mode: "lines", fill: "tozeroy" } },
  { id: "bar", label: "Bar", patch: { type: "bar" } },
  { id: "histogram", label: "Histogram", patch: { type: "histogram" } },
  { id: "box", label: "Box", patch: { type: "box" } },
  { id: "pie", label: "Pie", patch: { type: "pie" } },
];

function chartTypeOf(trace: ChartTrace | undefined): string {
  if (trace === undefined) return "lines+markers";
  if (trace.type !== "scatter") return trace.type;
  return trace.fill !== undefined ? "area" : trace.mode ?? "lines";
}

/** The series Add series makes: the first column against the next one no series shows yet. */
function newSeries(model: FigureModel, table: ChartTable): ChartTrace {
  const used = new Set(model.traces.map((t) => t.y));
  const free = table.cols.findIndex((_, i) => i > 0 && !used.has(columnLetter(i)));
  const trace: ChartTrace = { type: "scatter", mode: "lines+markers" };
  if (table.cols.length > 0) trace.x = "A";
  if (table.cols.length > 1) trace.y = columnLetter(free > 0 ? free : 1);
  return trace;
}

/** The badges of each column: X, Y<n> and ±Y<n> for the series that map it. */
function badgesOf(model: FigureModel, col: number): ColumnBadge[] {
  const letter = columnLetter(col);
  return model.traces.flatMap((trace, i): ColumnBadge[] => [
    ...(trace.x === letter ? [{ text: "X" }] : []),
    ...(trace.y === letter ? [{ text: `Y${i + 1}`, color: seriesColour(trace, i) }] : []),
    ...(trace.ey === letter ? [{ text: `±Y${i + 1}`, color: seriesColour(trace, i) }] : []),
  ]);
}

/** The model index of the n-th drawn trace (hidden series draw nothing). */
function traceAt(model: FigureModel, drawn: number): number | null {
  let seen = -1;
  for (let i = 0; i < model.traces.length; i += 1) if (model.traces[i]!.hidden !== true && ++seen === drawn) return i;
  return null;
}

export function createDataMode(ctx: ModeContext): FigureMode {
  const { shell, host } = ctx;
  const readOnly = ctx.model().src !== undefined && ctx.table === null;
  let table: ChartTable = ctx.model().data ?? ctx.table ?? { cols: [] };
  let selected: number | null = ctx.model().traces.length > 0 ? 0 : null;
  let tab: DataTab = "mapping";
  let bottomTab = "table";

  const plot = mountStagePlot(shell.stage, host.loadPlotly, { onPoint: (drawn, row) => { const i = traceAt(ctx.model(), drawn); if (i !== null) { selected = i; refresh(); grid.selectRow(row); } } });
  plot.element.classList.add("fe-paper");
  const gridRoot = renderElement("div", { class: "fe-grid" });
  const grid = mountDataGrid(gridRoot, table, { onChange: (next) => setTable(next), badges: (col) => badgesOf(ctx.model(), col), tools: false, ...(readOnly ? { readOnly: true } : {}) });

  const change = (next: FigureModel): void => { ctx.change(next); refresh(); };
  const setTable = (next: ChartTable): void => { table = next; const { src: _src, ...rest } = ctx.model(); change({ ...rest, data: next }); };
  const setTraces = (traces: ChartTrace[]): void => change({ ...ctx.model(), traces });

  const importTable = async (): Promise<void> => {
    const picked = await host.files?.pickTextFile(IMPORT_TYPES);
    if (!picked) return;
    if (table.cols.length > 0 && !(await askDialog("Replace the table?", `The rows of ${picked.name} replace the figure's table.`, "Replace"))) return;
    grid.update(parseCsv(picked.text).table);
    setTable(parseCsv(picked.text).table);
  };
  const pasteTable = async (): Promise<void> => {
    const text = await navigator.clipboard?.readText?.().catch(() => null);
    if (!text) { showToast("Copy a table, then paste it into the grid with ⌘V / Ctrl+V.", "info"); return; }
    const next = parseCsv(text).table;
    grid.update(next);
    setTable(next);
  };
  const actions: DataPanelActions = {
    ...(host.files && !readOnly ? { importCsv: () => void importTable() } : {}),
    pasteTable: () => void pasteTable(),
    select: (i) => { selected = i; refresh(); },
    toggle: (i) => setTraces(ctx.model().traces.map((t, j) => (j === i ? { ...t, hidden: t.hidden === true ? undefined : true } as ChartTrace : t)).map((t) => (t.hidden === undefined ? (({ hidden: _h, ...rest }) => rest)(t) : t))),
    add: () => { const traces = [...ctx.model().traces, newSeries(ctx.model(), table)]; selected = traces.length - 1; setTraces(traces); },
    move: (i, d) => { const traces = [...ctx.model().traces]; const to = i + d; if (to < 0 || to >= traces.length) return; [traces[i], traces[to]] = [traces[to]!, traces[i]!]; selected = to; setTraces(traces); },
    duplicate: (i) => { const traces = [...ctx.model().traces]; traces.splice(i + 1, 0, { ...traces[i]! }); selected = i + 1; setTraces(traces); },
    remove: (i) => { selected = null; setTraces(ctx.model().traces.filter((_, j) => j !== i)); },
  };

  const typeSelect = wsSelect(CHART_TYPES.map((t) => ({ value: t.id, label: t.label })), chartTypeOf(ctx.model().traces[selected ?? 0]), (id) => {
    const patch = CHART_TYPES.find((t) => t.id === id)!.patch;
    setTraces(ctx.model().traces.map((t, i) => (selected === null || i === selected ? (({ fill: _f, mode: _m, ...rest }) => ({ ...rest, ...patch }))(t) as ChartTrace : t)));
  }, "Chart type");
  const legend = wsToggle("Legend", ctx.model().layout.legend.show, (show) => change({ ...ctx.model(), layout: { ...ctx.model().layout, legend: { ...ctx.model().layout.legend, show } } }));
  const tools = wsSegmented([{ id: "zoom", label: "Select", icon: "pointer" }, { id: "pan", label: "Pan", icon: "hand" }], "zoom", (id) => plot.setDrag(id as "zoom" | "pan"), "fe-tools");
  shell.toolbar.replaceChildren(tools.element, renderElement("span", { class: "ws-toolbar-sep" }), typeSelect, renderElement("span", { class: "ws-toolbar-sep" }),
    wsButton({ icon: "axes", label: "Axes", showLabel: true }, () => { selected = null; refresh(); }), legend.element, renderElement("span", { class: "ws-spacer" }),
    wsButton({ icon: "screen-full", label: "Fit", showLabel: true }, () => plot.fit(), { variant: "outline" }));

  const importPane = renderElement("div", { class: "fe-import" }, renderElement("p", { text: "Paste CSV or TSV into the table, or import a file; the first row names the columns." }),
    ...(actions.importCsv ? [wsButton({ icon: "add", label: "Import CSV", showLabel: true }, () => actions.importCsv!(), { variant: "outline" })] : []));
  const bottomHead = renderElement("div", { class: "fe-bottom-head" });
  const renderBottom = (): void => {
    const name = ctx.model().src?.split("/").pop() ?? "Inline table";
    const tabs = wsSegmented([{ id: "table", label: "Table" }, { id: "import", label: "Import" }], bottomTab, (id) => { bottomTab = id; renderBottom(); });
    bottomHead.replaceChildren(renderElement("span", { class: "fe-bottom-name", text: name }), tabs.element, renderElement("span", { class: "ws-spacer" }),
      ...(readOnly ? [] : [wsButton({ icon: "add", label: "Row", showLabel: true }, () => grid.addRow(), { variant: "outline" })]));
    gridRoot.hidden = bottomTab !== "table";
    importPane.hidden = bottomTab !== "import";
  };
  shell.bottom.hidden = false;
  shell.bottom.replaceChildren(bottomHead, gridRoot, importPane, renderElement("div", { class: "fe-bottom-foot" }));

  function refresh(): void {
    const model = ctx.model();
    if (selected !== null && selected >= model.traces.length) selected = null;
    renderDataPanels(shell.left, model, table, selected, actions);
    renderDataInspector(shell.inspector, { model, table, selected, tab }, { change, tab: (t) => { tab = t; refresh(); }, deselect: () => { selected = null; refresh(); } });
    typeSelect.value = chartTypeOf(model.traces[selected ?? 0]);
    legend.set(model.layout.legend.show);
    plot.draw(figurePlotly(model, table, EXPORT_THEME));
    grid.refresh();
    renderBottom();
    (shell.bottom.lastElementChild as HTMLElement).textContent = `${tableRows(table)} rows`;
    shell.status.left.textContent = `${tableRows(table)} rows · ${model.traces.length} series · 1 panel`;
    shell.status.center.textContent = readOnly ? `${host.missing ?? "The data file was not found"}; the table is read-only` : "Selection synced with the table";
    shell.status.right.replaceChildren(wsCheck("Live update"));
  }
  refresh();

  return {
    async parts(model) {
      const placed = await commitChart(model, table, host.files);
      if (placed.model === null) { showToast(`Could not write the data file: ${placed.error}`, "error"); return null; }
      return { model: placed.model, ...(await chartFigureParts(host.loadPlotly, model, table)) };
    },
    code: async (model) => figurePgf(model, table) ?? `% No pgfplots picture: this figure is stored as an image.\n${JSON.stringify(model, null, 2)}`,
    destroy() { plot.destroy(); grid.destroy(); },
  };
}
