// The data chart editor: a left nav (Structure › Traces; Style › General, Traces, Axes, Legend) that arrow keys move through,
// the Traces panel with '+ Trace' and the trace cards, the Style placeholders, and a live preview that redraws on each change.
import { askDialog, renderElement } from "../../../ui/dom/index.js";
import { chartFigure, type ChartFigure, type ChartModel, type ChartTable, type ChartTrace } from "../../chart/index.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";
import { EXPORT_THEME } from "./exportPng.js";
import { mountChartPreview } from "./preview.js";
import { columnLetter, renderTraceCard, type TraceCardActions } from "./traceCards.js";

interface Section { id: string; group: "Structure" | "Style"; label: string; settings?: string }

const SECTIONS: readonly Section[] = [
  { id: "traces", group: "Structure", label: "Traces" },
  { id: "style-general", group: "Style", label: "General", settings: "Title, width, height and colour scale." },
  { id: "style-traces", group: "Style", label: "Traces", settings: "Colour, opacity, line and marker of each trace, and its legend entry." },
  { id: "style-axes", group: "Style", label: "Axes", settings: "Axis titles, scale (linear or log), range, ticks and grid." },
  { id: "style-legend", group: "Style", label: "Legend", settings: "Show the legend, its position and orientation." },
];

const NEXT_KEYS: readonly string[] = ["ArrowDown", "ArrowRight"];
const PREV_KEYS: readonly string[] = ["ArrowUp", "ArrowLeft"];

let mountCount = 0;

/** The figure the preview draws: the chart as it exports, on white. */
function previewFigure(model: ChartModel, table: ChartTable): ChartFigure {
  const figure = chartFigure(model, table, EXPORT_THEME);
  return { data: figure.data, layout: { ...figure.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" } };
}

/** The trace '+ Trace' adds: a line of column A against the next unused column. */
function newTrace(model: ChartModel, table: ChartTable): ChartTrace {
  const trace: ChartTrace = { type: "scatter", mode: "lines" };
  if (table.cols.length > 0) trace.x = "A";
  if (table.cols.length > 1) trace.y = columnLetter(Math.min(model.traces.length + 1, table.cols.length - 1));
  return trace;
}

interface Nav { nav: HTMLElement; body: HTMLElement; panels: Map<string, HTMLElement>; show(id: string): void }

/** One section's tab and its panel (the placeholder text for the Style sections). */
function renderSection(uid: string, section: Section): { tab: HTMLButtonElement; panel: HTMLElement } {
  const tab = renderElement("button", { class: "qmd-chart-nav-item", type: "button", role: "tab", id: `${uid}-tab-${section.id}`, "aria-controls": `${uid}-panel-${section.id}`, text: section.label });
  tab.dataset.section = section.id;
  const panel = renderElement("section", { class: "qmd-chart-panel", role: "tabpanel", id: `${uid}-panel-${section.id}`, "aria-labelledby": `${uid}-tab-${section.id}` });
  if (section.settings !== undefined) {
    panel.append(
      renderElement("h3", { class: "qmd-chart-panel-title", text: `${section.group} › ${section.label}` }),
      renderElement("p", { class: "qmd-chart-panel-note", text: section.settings }),
      renderElement("p", { class: "qmd-chart-panel-note", text: "These settings are not editable yet." }),
    );
  }
  return { tab, panel };
}

/** The arrow, Home, End, Enter and Space keys of the nav's tabs. */
function onNavKeydown(event: KeyboardEvent, order: readonly HTMLButtonElement[], show: (id: string) => void): void {
  const tab = (event.target as HTMLElement).closest<HTMLButtonElement>('[role="tab"]');
  if (tab === null) return;
  const at = order.indexOf(tab);
  let next = -1;
  if (NEXT_KEYS.includes(event.key)) next = (at + 1) % order.length;
  else if (PREV_KEYS.includes(event.key)) next = (at - 1 + order.length) % order.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = order.length - 1;
  else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    show(tab.dataset.section!);
    return;
  }
  if (next < 0) return;
  event.preventDefault();
  order[next]!.focus();
}

/** The left nav with its two groups of tabs, the panels they show, and `show` to select one. */
function buildNav(uid: string): Nav {
  const tabs = new Map<string, HTMLButtonElement>();
  const panels = new Map<string, HTMLElement>();
  const nav = renderElement("nav", { class: "qmd-chart-nav", "aria-label": "Chart settings" });
  const body = renderElement("div", { class: "qmd-chart-panels" });
  for (const group of ["Structure", "Style"] as const) {
    const headingId = `${uid}-${group.toLowerCase()}`;
    const list = renderElement("div", { class: "qmd-chart-nav-list", role: "tablist", "aria-orientation": "vertical", "aria-labelledby": headingId });
    for (const section of SECTIONS.filter((s) => s.group === group)) {
      const { tab, panel } = renderSection(uid, section);
      tabs.set(section.id, tab);
      panels.set(section.id, panel);
      list.append(tab);
      body.append(panel);
    }
    nav.append(renderElement("div", { class: "qmd-chart-nav-group" }, renderElement("div", { class: "qmd-chart-nav-heading", id: headingId, text: group }), list));
  }
  const show = (id: string): void => {
    for (const [key, tab] of tabs) {
      const on = key === id;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      panels.get(key)!.hidden = !on;
    }
  };
  const order = [...tabs.values()];
  nav.addEventListener("click", (event) => {
    const tab = (event.target as HTMLElement).closest<HTMLElement>('[role="tab"]');
    if (tab?.dataset.section !== undefined) show(tab.dataset.section);
  });
  nav.addEventListener("keydown", (event) => onNavKeydown(event, order, show));
  return { nav, body, panels, show };
}

interface TraceList { add: HTMLButtonElement; render(model: ChartModel, table: ChartTable, actions: TraceCardActions): void }

/** The Traces panel's heading, card list, empty note and '+ Trace' button; `render` redraws the cards, keeping focus on the control of the same name. */
function mountTraceList(panel: HTMLElement): TraceList {
  const list = renderElement("ol", { class: "qmd-chart-cards", "aria-label": "Traces" });
  const empty = renderElement("p", { class: "qmd-chart-panel-note", text: "No traces yet." });
  const add = renderElement("button", { class: "ls-btn qmd-chart-add-trace", type: "button", text: "+ Trace" });
  panel.append(renderElement("h3", { class: "qmd-chart-panel-title", text: "Structure › Traces" }), list, empty, add);
  return {
    add,
    render(model, table, actions) {
      const active = document.activeElement;
      const focusName = active instanceof HTMLElement && list.contains(active) ? active.getAttribute("aria-label") : null;
      list.replaceChildren(...model.traces.map((trace, i) => renderTraceCard(trace, i, model.traces.length, table, actions)));
      empty.hidden = model.traces.length > 0;
      if (focusName === null) return;
      const again = [...list.querySelectorAll<HTMLElement>("[aria-label]")].find((el) => el.getAttribute("aria-label") === focusName && !(el instanceof HTMLButtonElement && el.disabled));
      (again ?? add).focus();
    },
  };
}

/** The edits a trace card asks for, each ending in `emit` with the new model; Remove asks first. */
function traceActions(getModel: () => ChartModel, emit: (next: ChartModel) => void, isDestroyed: () => boolean): TraceCardActions {
  const withTraces = (traces: ChartTrace[]): ChartModel => ({ ...getModel(), traces });
  return {
    change(index, trace) {
      emit(withTraces(getModel().traces.map((t, i) => (i === index ? trace : t))));
    },
    move(index, delta) {
      const to = index + delta;
      const traces = [...getModel().traces];
      if (to < 0 || to >= traces.length) return;
      [traces[index], traces[to]] = [traces[to]!, traces[index]!];
      emit(withTraces(traces));
    },
    remove(index) {
      const trace = getModel().traces[index];
      if (trace === undefined) return;
      void askDialog(`Remove trace ${index + 1}?`, "The trace leaves the chart; the table keeps its columns.", "Remove", true).then((yes) => {
        if (!yes || isDestroyed()) return;
        const at = getModel().traces.indexOf(trace);
        if (at >= 0) emit(withTraces(getModel().traces.filter((_, i) => i !== at)));
      });
    },
  };
}

/** Mounts the data editor in `root`; edits go to `onChange`, `update` hands the host's model and table back. */
export function mountDataEditor(root: HTMLElement, state: { model: ChartModel; table: ChartTable }, onChange: (model: ChartModel) => void, loadPlotly: EditorPlotlyLoader): { update(model: ChartModel, table: ChartTable): void; destroy(): void } {
  let model = state.model;
  let table = state.table;
  let destroyed = false;
  const { nav, body, panels, show } = buildNav(`qmd-chart-data-${++mountCount}`);
  const traceList = mountTraceList(panels.get("traces")!);
  const previewRoot = renderElement("div", { class: "qmd-chart-data-preview" });
  root.append(renderElement("div", { class: "qmd-chart-data-editor" }, nav, body, previewRoot));
  const preview = mountChartPreview(previewRoot, loadPlotly);

  const redraw = (): void => {
    traceList.render(model, table, actions);
    preview.draw(previewFigure(model, table));
  };
  const emit = (next: ChartModel): void => {
    if (destroyed) return;
    model = next;
    redraw();
    onChange(next);
  };
  const actions = traceActions(() => model, emit, () => destroyed);
  traceList.add.addEventListener("click", () => emit({ ...model, traces: [...model.traces, newTrace(model, table)] }));

  show("traces");
  redraw();

  return {
    update(next, nextTable) {
      if (destroyed || (next === model && nextTable === table)) return;
      model = next;
      table = nextTable;
      redraw();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      preview.destroy();
      root.replaceChildren();
    },
  };
}
