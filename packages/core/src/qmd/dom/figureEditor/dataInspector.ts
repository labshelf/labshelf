// The data mode's inspector: for the selected series a Mapping tab (source, X and Y columns with their units, Y errors,
// legend name, display as points, lines or both, then axes and scale and export) and a Style tab (colour, line width, marker
// size, opacity, area fill, legend); with no series selected, the figure's title, axes, legend and size.
import { renderElement, wsColour, wsField, wsInput, wsNumber, wsRow, wsSection, wsSegmented, wsSelect, wsSlider, wsToggle, type WsInspector } from "../../../ui/dom/index.js";
import { columnLetter, type ChartAxis, type ChartModel, type ChartTable, type ChartTrace, type FigureModel } from "../../chart/index.js";
import { seriesColour } from "./dataPanels.js";
import { renderStylePanel, type StylePanel } from "./stylePanels.js";

export type DataTab = "mapping" | "style";

export interface DataInspectorState { model: FigureModel; table: ChartTable; selected: number | null; tab: DataTab }

export interface DataInspectorActions { change(next: FigureModel): void; tab(tab: DataTab): void; deselect(): void }

const DISPLAY = [{ id: "markers", label: "Points" }, { id: "lines", label: "Lines" }, { id: "lines+markers", label: "Both" }] as const;

/** The column choices of a select: each column by its header (or letter), after an optional None. */
function columnOptions(table: ChartTable, none?: string): { value: string; label: string }[] {
  const cols = table.cols.map((col, i) => ({ value: columnLetter(i), label: col.name.trim() || columnLetter(i) }));
  return none === undefined ? cols : [{ value: "", label: none }, ...cols];
}

/** A copy of `obj` with `key` set, or removed when `value` is undefined or empty. */
function withKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined | ""): T {
  const { [key]: _old, ...rest } = obj;
  return (value === undefined || value === "" ? rest : { ...rest, [key]: value }) as T;
}

/** One of the shared style panels (axes, legend, general), editing the figure as the chart it draws. */
function stylePanel(panel: StylePanel, s: DataInspectorState, a: DataInspectorActions): HTMLElement {
  const chart: ChartModel = { ...s.model, kind: "data" };
  return renderStylePanel(panel, chart, (next) => a.change({ ...s.model, ...next, kind: s.model.kind }));
}

function collapsible(title: string, content: HTMLElement): HTMLElement {
  const section = wsSection(title, { collapsible: true, open: false });
  section.body.append(content);
  return section.element;
}

/** A column select and the unit of the axis it feeds. */
function axisField(label: string, column: string | undefined, axis: ChartAxis, s: DataInspectorState, set: { column(letter: string): void; unit(unit: string): void }): HTMLElement {
  const select = wsSelect(columnOptions(s.table), column ?? "", set.column, `${label} column`);
  const unit = wsInput(axis.unit ?? "", (text) => set.unit(text.trim()), { placeholder: "Unit", label: `${label} unit` });
  unit.classList.add("fe-unit");
  return wsField(label, renderElement("div", { class: "fe-inline" }, select, unit));
}

/** The Mapping tab of a series. */
function mappingTab(trace: ChartTrace, index: number, s: DataInspectorState, a: DataInspectorActions): HTMLElement[] {
  const setTrace = (next: ChartTrace): void => a.change({ ...s.model, traces: s.model.traces.map((t, i) => (i === index ? next : t)) });
  const setAxis = (key: "xaxis" | "yaxis", unit: string): void => a.change({ ...s.model, layout: { ...s.model.layout, [key]: withKey(s.model.layout[key], "unit", unit) } });
  const main = wsSection("Mapping");
  const source = wsSelect([{ value: "", label: s.model.src?.split("/").pop() ?? "Inline table" }], "", () => undefined, "Source");
  source.disabled = true;
  const errors = wsSelect(columnOptions(s.table, "None"), trace.ey ?? "", (letter) => setTrace(withKey(trace, "ey", letter)), "Errors in Y");
  main.body.append(
    wsField("Source", source),
    axisField("X axis", trace.x, s.model.layout.xaxis, s, { column: (x) => setTrace({ ...trace, x }), unit: (u) => setAxis("xaxis", u) }),
    axisField("Y axis", trace.y, s.model.layout.yaxis, s, { column: (y) => setTrace({ ...trace, y }), unit: (u) => setAxis("yaxis", u) }),
    wsField("Errors in Y", errors),
    ...(trace.ey ? [renderElement("span", { class: "fe-hint", text: "± symmetric" })] : []),
    wsField("Legend", wsInput(trace.name ?? "", (name) => setTrace(withKey(trace, "name", name.trim())), { label: "Legend name" })),
  );
  if (trace.type === "scatter") main.body.append(wsField("Display", wsSegmented(DISPLAY, trace.mode ?? "lines", (mode) => setTrace({ ...trace, mode }), "fe-wide").element));
  return [main.element, collapsible("Axes and scale", stylePanel("axes", s, a)), collapsible("Export", stylePanel("general", s, a))];
}

/** The Style tab of a series. */
function styleTab(trace: ChartTrace, index: number, s: DataInspectorState, a: DataInspectorActions): HTMLElement[] {
  const setTrace = (next: ChartTrace): void => a.change({ ...s.model, traces: s.model.traces.map((t, i) => (i === index ? next : t)) });
  const main = wsSection("Style");
  main.body.append(
    wsRow("Colour", wsColour(seriesColour(trace, index), (color) => setTrace({ ...trace, color }))),
    wsRow("Line width", wsNumber(trace.lineWidth ?? 2, (w) => setTrace({ ...trace, lineWidth: w }), { min: 0.5, max: 12, step: 0.5, label: "Line width" })),
    wsRow("Marker", wsNumber(trace.markerSize ?? 6, (m) => setTrace({ ...trace, markerSize: m }), { min: 1, max: 30, step: 1, label: "Marker size" })),
    wsRow("Opacity", wsSlider(trace.opacity ?? 1, { min: 0, max: 1, step: 0.05 }, (o) => setTrace({ ...trace, opacity: o }), "Opacity").element),
  );
  if (trace.type === "scatter") main.body.append(wsToggle("Fill the area under", trace.fill !== undefined, (on) => setTrace(withKey(trace, "fill", on ? "tozeroy" : undefined))).element);
  return [main.element, collapsible("Legend", stylePanel("legend", s, a))];
}

/** The figure's own settings, shown while no series is selected. */
function figureSettings(s: DataInspectorState, a: DataInspectorActions): HTMLElement[] {
  const main = wsSection("Figure");
  main.body.append(wsField("Title", wsInput(s.model.title ?? "", (title) => a.change(withKey(s.model, "title", title.trim())), { label: "Title" })));
  return [main.element, collapsible("Axes and scale", stylePanel("axes", s, a)), collapsible("Legend", stylePanel("legend", s, a)), collapsible("Export", stylePanel("general", s, a))];
}

/** Fills the inspector for the state. */
export function renderDataInspector(inspector: WsInspector, s: DataInspectorState, a: DataInspectorActions): void {
  const trace = s.selected === null ? undefined : s.model.traces[s.selected];
  if (trace === undefined || s.selected === null) {
    inspector.show({ title: "Figure", icon: "graph-line" });
    inspector.body.replaceChildren(...figureSettings(s, a), renderElement("p", { class: "ws-empty", text: "Select a series to map its columns." }));
    return;
  }
  const index = s.selected;
  inspector.show({ title: `Series · ${trace.name?.trim() || `Series ${index + 1}`}`, swatch: seriesColour(trace, index), tabs: [{ id: "mapping", label: "Mapping" }, { id: "style", label: "Style" }], tab: s.tab, onTab: (id) => a.tab(id as DataTab), onClose: a.deselect });
  inspector.body.replaceChildren(...(s.tab === "mapping" ? mappingTab(trace, index, s, a) : styleTab(trace, index, s, a)));
}
