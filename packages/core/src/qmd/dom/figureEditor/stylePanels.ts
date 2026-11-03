// The data editor's Style panels: General (title, size, font size, default colour scale, bar mode), Traces (per trace colour, opacity, mode, line width, marker size, fill, legend entry),
// Axes (per axis title, scale, range, ticks, grid) and Legend (show, position, orientation). Every committed change reports a new model once; the old one is never mutated.
import { renderElement } from "../../../ui/dom/index.js";
import { CHART_COLORSCALES, EXPORT_THEME, type ChartAxis, type ChartLayout, type ChartModel, type ChartTrace, type ChartTraceType } from "../../chart/index.js";
import { checkField, colourField, numberField, segmentedField, selectField, textField } from "./fields.js";

export type StylePanel = "general" | "traces" | "axes" | "legend";

/** The heading and the line naming each panel's settings. */
export const STYLE_PANELS: Readonly<Record<StylePanel, { label: string; settings: string }>> = {
  general: { label: "General", settings: "Title, width, height, font size, colour scale and bar mode." },
  traces: { label: "Traces", settings: "Colour, opacity, line and marker of each trace, and its legend entry." },
  axes: { label: "Axes", settings: "Axis titles, scale (linear or log), range, ticks and grid." },
  legend: { label: "Legend", settings: "Show the legend, its position and orientation." },
};

/** Types whose trace takes one colour of its own. */
const COLOURED: readonly ChartTraceType[] = ["scatter", "bar", "histogram", "box", "scatter3d", "mesh3d"];
const LINED: readonly ChartTraceType[] = ["scatter", "scatter3d"];
const SCENE_TYPES: readonly ChartTraceType[] = ["surface", "scatter3d", "mesh3d"];
const BAR_TYPES: readonly ChartTraceType[] = ["bar", "histogram"];

const MODES: readonly { value: string; label: string }[] = [
  { value: "lines", label: "Lines" },
  { value: "markers", label: "Markers" },
  { value: "lines+markers", label: "Lines and markers" },
];
const FILLS: readonly { value: string; label: string }[] = [
  { value: "", label: "None" },
  { value: "tozeroy", label: "Down to zero" },
  { value: "tonexty", label: "Down to the previous trace" },
  { value: "toself", label: "Closed shape" },
];

/** Legend places as Plotly x and y (paper fractions, anchored at the legend's left, top or bottom edge by Plotly's auto anchor). */
const LEGEND_PLACES: readonly { value: string; label: string; x: number; y: number }[] = [
  { value: "right", label: "Right of the plot", x: 1.02, y: 1 },
  { value: "top-left", label: "Top left, inside", x: 0.02, y: 0.98 },
  { value: "bottom-left", label: "Bottom left, inside", x: 0.02, y: 0.02 },
  { value: "below", label: "Below the plot", x: 0, y: -0.25 },
];

/** The panel's model, updated after each change it reports, so edits made in the same panel add up. */
interface Edit {
  get(): ChartModel;
  commit(next: ChartModel): void;
}

function withLayout(model: ChartModel, layout: ChartLayout): ChartModel {
  return { ...model, layout };
}

/** A copy of `obj` with `key` set, or removed when `value` is undefined. */
function setKey<T extends object, K extends keyof T>(obj: T, key: K, value: T[K] | undefined): T {
  const next = { ...obj };
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next;
}

function group(legend: string, ...children: HTMLElement[]): HTMLElement {
  return renderElement("fieldset", { class: "qmd-chart-style-group" }, renderElement("legend", { class: "qmd-chart-style-legend", text: legend }), ...children);
}

function generalPanel(edit: Edit): HTMLElement[] {
  const model = edit.get();
  const layoutKey = <K extends keyof ChartLayout>(key: K) => (value: ChartLayout[K] | undefined): void => {
    const now = edit.get();
    edit.commit(withLayout(now, setKey(now.layout, key, value)));
  };
  const size = (key: "width" | "height") => (value: number | null): void => layoutKey(key)(value ?? undefined);
  const fields: HTMLElement[] = [
    textField("Title", model.title ?? "", (value) => edit.commit(setKey(edit.get(), "title", value === "" ? undefined : value))),
    renderElement("div", { class: "qmd-chart-style-row" },
      numberField("Width", model.layout.width ?? null, size("width"), { step: 10, min: 1, allowEmpty: true }),
      numberField("Height", model.layout.height ?? null, size("height"), { step: 10, min: 1, allowEmpty: true })),
    numberField("Font size", model.layout.fontSize ?? null, (value) => layoutKey("fontSize")(value ?? undefined), { step: 1, min: 1, allowEmpty: true }),
    selectField("Colour scale", [{ value: "", label: "Default (Viridis)" }, ...CHART_COLORSCALES.map((s) => ({ value: s, label: s }))], model.layout.colorscale ?? "",
      (value) => layoutKey("colorscale")(value === "" ? undefined : value)),
  ];
  if (model.traces.some((t) => BAR_TYPES.includes(t.type))) {
    fields.push(selectField("Bar mode", [{ value: "group", label: "Grouped" }, { value: "stack", label: "Stacked" }], model.layout.barmode ?? "group",
      (value) => layoutKey("barmode")(value as ChartLayout["barmode"])));
  }
  return fields;
}

/** The controls of one trace in the Traces panel. */
function traceGroup(edit: Edit, trace: ChartTrace, index: number): HTMLElement {
  const palette = EXPORT_THEME.palette;
  const set = <K extends keyof ChartTrace>(key: K, value: ChartTrace[K] | undefined): void => {
    const now = edit.get();
    const at = now.traces[index];
    if (at === undefined) return;
    edit.commit({ ...now, traces: now.traces.map((t, i) => (i === index ? setKey(at, key, value) : t)) });
  };
  const fields: HTMLElement[] = [];
  if (COLOURED.includes(trace.type)) fields.push(colourField("Colour", trace.color ?? palette[index % palette.length] ?? "#808080", palette, (value) => set("color", value)));
  fields.push(numberField("Opacity", trace.opacity ?? null, (value) => set("opacity", value ?? undefined), { step: 0.05, min: 0, max: 1, allowEmpty: true }));
  if (LINED.includes(trace.type)) {
    const mode = trace.mode ?? (trace.type === "scatter" ? "lines" : "markers");
    fields.push(selectField("Mode", MODES, mode, (value) => set("mode", value)));
    if (mode.includes("lines")) fields.push(numberField("Line width", trace.lineWidth ?? null, (value) => set("lineWidth", value ?? undefined), { step: 0.5, min: 0.5, allowEmpty: true }));
    if (mode.includes("markers")) fields.push(numberField("Marker size", trace.markerSize ?? null, (value) => set("markerSize", value ?? undefined), { step: 1, min: 1, allowEmpty: true }));
  }
  if (trace.type === "scatter") fields.push(selectField("Fill", FILLS, trace.fill ?? "", (value) => set("fill", value === "" ? undefined : value)));
  fields.push(checkField("Show in legend", trace.showlegend !== false, (on) => set("showlegend", on ? undefined : false)));
  const name = trace.name?.trim() ?? "";
  return group(name === "" ? `Trace ${index + 1}` : `Trace ${index + 1}: ${name}`, ...fields);
}

function tracesPanel(edit: Edit): HTMLElement[] {
  const { traces } = edit.get();
  if (traces.length === 0) return [renderElement("p", { class: "qmd-chart-panel-note", text: "No traces yet." })];
  return traces.map((trace, i) => traceGroup(edit, trace, i));
}

/** The controls of one axis: title, scale, range (Auto, or Manual with min and max), tick count and grid lines. */
function axisGroup(edit: Edit, key: "xaxis" | "yaxis" | "zaxis", name: string): HTMLElement {
  const axis: ChartAxis = edit.get().layout[key] ?? { type: "linear" };
  const setAxis = (change: (axis: ChartAxis) => ChartAxis): void => {
    const now = edit.get();
    edit.commit(withLayout(now, { ...now.layout, [key]: change(now.layout[key] ?? { type: "linear" }) }));
  };
  const pending: [number | null, number | null] = axis.range ? [axis.range[0], axis.range[1]] : [null, null];
  const applyRange = (): void => {
    const [min, max] = pending;
    const has = edit.get().layout[key]?.range !== undefined;
    if (min !== null && max !== null) setAxis((a) => ({ ...a, range: [min, max] }));
    else if (has) setAxis((a) => setKey(a, "range", undefined));
  };
  const bounds = renderElement("div", { class: "qmd-chart-style-row" },
    numberField("Min", pending[0], (value) => { pending[0] = value; applyRange(); }, { allowEmpty: true }),
    numberField("Max", pending[1], (value) => { pending[1] = value; applyRange(); }, { allowEmpty: true }));
  bounds.hidden = axis.range === undefined;
  const range = segmentedField("Range", [{ id: "auto", label: "Auto" }, { id: "manual", label: "Manual" }], axis.range === undefined ? "auto" : "manual", (id) => {
    bounds.hidden = id === "auto";
    if (id === "auto") {
      if (edit.get().layout[key]?.range !== undefined) setAxis((a) => setKey(a, "range", undefined));
    } else if (pending[0] !== null && pending[1] !== null) applyRange();
  });
  return group(name,
    textField("Title", axis.title ?? "", (value) => setAxis((a) => setKey(a, "title", value === "" ? undefined : value))),
    segmentedField("Scale", [{ id: "linear", label: "Linear" }, { id: "log", label: "Log" }], axis.type, (id) => setAxis((a) => ({ ...a, type: id as ChartAxis["type"] }))),
    range,
    bounds,
    numberField("Tick count", axis.ticks ?? null, (value) => setAxis((a) => setKey(a, "ticks", value === null ? undefined : Math.max(1, Math.round(value)))), { step: 1, min: 1, allowEmpty: true }),
    checkField("Grid lines", axis.grid !== false, (on) => setAxis((a) => setKey(a, "grid", on ? undefined : false))),
  );
}

function axesPanel(edit: Edit): HTMLElement[] {
  const model = edit.get();
  const groups = [axisGroup(edit, "xaxis", "X axis"), axisGroup(edit, "yaxis", "Y axis")];
  if (model.layout.zaxis !== undefined || model.traces.some((t) => SCENE_TYPES.includes(t.type))) groups.push(axisGroup(edit, "zaxis", "Z axis"));
  return groups;
}

function legendPanel(edit: Edit): HTMLElement[] {
  const { legend } = edit.get().layout;
  const setLegend = (change: (legend: ChartLayout["legend"]) => ChartLayout["legend"]): void => {
    const now = edit.get();
    edit.commit(withLayout(now, { ...now.layout, legend: change(now.layout.legend) }));
  };
  const place = LEGEND_PLACES.find((p) => p.x === legend.x && p.y === legend.y);
  const custom = place === undefined && (legend.x !== undefined || legend.y !== undefined);
  const places = [{ value: "", label: "Automatic" }, ...LEGEND_PLACES, ...(custom ? [{ value: "custom", label: "Custom" }] : [])];
  return [
    checkField("Show legend", legend.show, (on) => setLegend((l) => ({ ...l, show: on }))),
    selectField("Position", places, place?.value ?? (custom ? "custom" : ""), (value) => {
      if (value === "custom") return;
      const chosen = LEGEND_PLACES.find((p) => p.value === value);
      setLegend((l) => {
        const next = setKey(setKey(l, "x", undefined), "y", undefined);
        return chosen === undefined ? next : { ...next, x: chosen.x, y: chosen.y };
      });
    }),
    segmentedField("Orientation", [{ id: "v", label: "Vertical" }, { id: "h", label: "Horizontal" }], legend.orientation ?? "v", (id) => setLegend((l) => ({ ...l, orientation: id as "v" | "h" }))),
  ];
}

const BUILDERS: Record<StylePanel, (edit: Edit) => HTMLElement[]> = { general: generalPanel, traces: tracesPanel, axes: axesPanel, legend: legendPanel };

/** One Style panel for `model`: its heading line naming the settings, then the controls; each committed change calls `onChange` once with a new model. */
export function renderStylePanel(panel: "general" | "traces" | "axes" | "legend", model: ChartModel, onChange: (model: ChartModel) => void): HTMLElement {
  let current = model;
  const edit: Edit = {
    get: () => current,
    commit(next) {
      current = next;
      onChange(next);
    },
  };
  const info = STYLE_PANELS[panel];
  return renderElement("div", { class: "qmd-chart-style" },
    renderElement("h3", { class: "qmd-chart-panel-title", text: `Style › ${info.label}` }),
    renderElement("p", { class: "qmd-chart-panel-note", text: info.settings }),
    ...BUILDERS[panel](edit));
}
