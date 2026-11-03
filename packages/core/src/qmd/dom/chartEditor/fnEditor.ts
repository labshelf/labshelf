// The function plot dialog (D9): tabs Expressions / Axes / X Axis / Y Axis beside a live preview with Zoom + / − and View full; in 3D (D13) also
// Z Axis, a Colourscale select in Axes, and a preview rotated by Plotly's scene drag whose camera is stored in the model, with Reset view.
// Expressions holds the '+ Add' menu of kinds, the function rows (fnRows.ts) and 'Variables +' with each variable's value and optional slider.
// Every edit reports a new model at once; the preview resamples and the rows' errors are refreshed at most once per animation frame.
import { closeMenu, mountPageTabs, renderElement, showMenu } from "../../../ui/dom/index.js";
import { chartFigure, EXPORT_THEME, fnTraces2d, fnTraces3d, type ChartFigure, type ChartFn, type ChartModel, type ChartVar } from "../../chart/index.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";
import { selectField } from "./fields.js";
import { mountFnRows, type FnRowError, type FnRows, type FnRowsHandlers } from "./fnRows.js";
import { mountChartPreview, type ScenePreviewOptions } from "./preview.js";
import { renderStylePanel } from "./stylePanels.js";

type Tab = "expressions" | "axes" | "x" | "y" | "z";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "expressions", label: "Expressions" }, { id: "axes", label: "Axes" }, { id: "x", label: "X Axis" }, { id: "y", label: "Y Axis" },
];
const TABS_3D: readonly { id: Tab; label: string }[] = [...TABS, { id: "z", label: "Z Axis" }];
/** Which axis fieldset of the Axes panel each axis tab keeps. */
const AXIS_INDEX: Record<"x" | "y" | "z", number> = { x: 0, y: 1, z: 2 };

/** The kinds '+ Add' offers in 2D and the function each starts with. */
const KINDS_2D: readonly { label: string; fn: ChartFn }[] = [
  { label: "y = f(x)", fn: { kind: "y", expr: [""] } },
  { label: "x = f(y)", fn: { kind: "x", expr: [""] } },
  { label: "Inequality", fn: { kind: "y", rel: "<", expr: [""] } },
  { label: "Parametric curve", fn: { kind: "param", expr: ["", ""] } },
  { label: "Polar curve", fn: { kind: "polar", expr: [""] } },
  { label: "Implicit curve", fn: { kind: "implicit", expr: [""] } },
];

/** The kinds '+ Add' offers in 3D and the function each starts with. */
const KINDS_3D: readonly { label: string; fn: ChartFn }[] = [
  { label: "z = f(x,y)", fn: { kind: "surface", expr: ["sin(x)*cos(y)"] } },
  { label: "Parametric surface", fn: { kind: "param3d", expr: ["cos(u)*sin(v)", "sin(u)*sin(v)", "cos(v)"] } },
  { label: "3D curve", fn: { kind: "curve3d", expr: ["cos(t)", "sin(t)", "t/5"] } },
];

/** The colourscales the 3D Axes tab offers (Plotly names). */
const COLOURSCALES: readonly string[] = ["Viridis", "Cividis", "Blues", "RdBu", "Portland", "Hot"];
const DEFAULT_COLOURSCALE = "Viridis";

/** Names a variable cannot take: the plot's own variables and constants (in 3D also the surface parameters u and v). */
const RESERVED_2D = new Set(["x", "y", "t", "θ", "e", "pi"]);
const RESERVED_3D = new Set([...RESERVED_2D, "u", "v"]);
const NAME = /^\p{L}+$/u;
const DEFAULT_VIEW: [number, number] = [-10, 10];
const NEW_SLIDER = { min: -10, max: 10, step: 0.1 };

let mountCount = 0;

/** Why `name` cannot name a variable, or null when it can. */
function nameProblem(name: string, others: readonly ChartVar[], reserved: ReadonlySet<string>): string | null {
  if (!NAME.test(name)) return "A variable name is letters only.";
  if (reserved.has(name)) return `${name} is taken by the plot; choose another name.`;
  if (others.some((v) => v.name === name)) return `${name} is already a variable.`;
  return null;
}

/** The first single letter free for a new variable. */
function freeName(vars: readonly ChartVar[], reserved: ReadonlySet<string>): string {
  for (const c of "abcdfghjklmnopqrsuvwz") if (!reserved.has(c) && !vars.some((v) => v.name === c)) return c;
  let name = "kk";
  while (vars.some((v) => v.name === name)) name += "k";
  return name;
}

function setVar(model: ChartModel, index: number, change: (v: ChartVar) => ChartVar): ChartModel {
  return { ...model, vars: model.vars.map((v, i) => (i === index ? change(v) : v)) };
}

function input(attrs: Record<string, string | number | undefined>): HTMLInputElement {
  return renderElement("input", { class: "qmd-chart-input", ...attrs });
}

type GetModel = () => ChartModel;
type SetVar = (model: ChartModel, rebuild: boolean) => void;

/** The name field of a variable with its message; a bad name shows why and is not stored. */
function nameField(v: ChartVar, index: number, reserved: ReadonlySet<string>, get: GetModel, set: SetVar): HTMLElement {
  const name = input({ type: "text", "aria-label": "Variable name", spellcheck: "false", class: "qmd-chart-input qmd-chart-fn-var-name" });
  name.value = v.name;
  const message = renderElement("div", { class: "qmd-chart-fn-message", role: "status" });
  message.hidden = true;
  name.addEventListener("change", () => {
    const next = name.value.trim();
    if (next === get().vars[index]?.name) return;
    const problem = nameProblem(next, get().vars.filter((_, i) => i !== index), reserved);
    name.classList.toggle("is-invalid", problem !== null);
    message.textContent = problem ?? "";
    message.hidden = problem === null;
    if (problem === null) set(setVar(get(), index, (x) => ({ ...x, name: next })), true);
  });
  return renderElement("div", { class: "qmd-chart-fn-field" }, name, message);
}

/** The value field and the slider of a variable, kept in step; each edit stores the value without a rebuild. */
function valueControls(v: ChartVar, index: number, get: GetModel, set: SetVar): { value: HTMLInputElement; slider: HTMLInputElement } {
  const value = input({ type: "number", "aria-label": `Value of ${v.name}`, step: v.step ?? "any", class: "qmd-chart-input qmd-chart-fn-var-value" });
  value.value = String(v.value);
  const slider = input({ type: "range", "aria-label": `${v.name} slider`, min: v.min, max: v.max, step: v.step ?? "any", class: "qmd-chart-fn-slider" });
  slider.hidden = v.min === undefined || v.max === undefined;
  slider.value = String(v.value);
  const write = (n: number): void => set(setVar(get(), index, (x) => ({ ...x, value: n })), false);
  value.addEventListener("input", () => {
    const n = Number(value.value);
    if (value.value.trim() === "" || !Number.isFinite(n)) return;
    slider.value = String(n);
    write(n);
  });
  slider.addEventListener("input", () => {
    const n = Number(slider.value);
    value.value = String(n);
    write(n);
  });
  return { value, slider };
}

/** The checkbox that gives a variable a slider with the default bounds, or takes it away. */
function sliderToggle(hasSlider: boolean, index: number, get: GetModel, set: SetVar): HTMLInputElement {
  const toggle = renderElement("input", { class: "qmd-chart-check", type: "checkbox" });
  toggle.checked = hasSlider;
  toggle.addEventListener("change", () => {
    set(setVar(get(), index, (x) => {
      if (toggle.checked) return { ...x, min: Math.min(NEW_SLIDER.min, x.value), max: Math.max(NEW_SLIDER.max, x.value), step: NEW_SLIDER.step };
      const { min: _min, max: _max, step: _step, ...rest } = x;
      return rest;
    }), true);
  });
  return toggle;
}

/** One bound (min, max or step) of a variable's slider; a bad entry is put back. */
function boundField(v: ChartVar, key: "min" | "max" | "step", label: string, index: number, get: GetModel, set: SetVar): HTMLInputElement {
  const field = input({ type: "number", "aria-label": `${label} of the ${v.name} slider`, step: "any", class: "qmd-chart-input qmd-chart-fn-var-bound" });
  field.value = v[key] === undefined ? "" : String(v[key]);
  field.addEventListener("change", () => {
    const n = Number(field.value);
    if (field.value.trim() === "" || !Number.isFinite(n) || (key === "step" && n <= 0)) { field.value = v[key] === undefined ? "" : String(v[key]); return; }
    set(setVar(get(), index, (x) => ({ ...x, [key]: n })), true);
  });
  return field;
}

/** One variable: name, value, an optional slider with its min, max and step, and remove. */
function varRow(v: ChartVar, index: number, reserved: ReadonlySet<string>, get: GetModel, set: SetVar): HTMLElement {
  const { value, slider } = valueControls(v, index, get, set);
  const hasSlider = v.min !== undefined && v.max !== undefined;
  const toggle = sliderToggle(hasSlider, index, get, set);
  const remove = renderElement("button", { class: "ls-btn qmd-chart-fn-tool", type: "button", "aria-label": `Remove variable ${v.name}`, title: `Remove variable ${v.name}`, text: "×" });
  remove.addEventListener("click", () => set({ ...get(), vars: get().vars.filter((_, i) => i !== index) }, true));
  const row = renderElement("li", { class: "qmd-chart-fn-var" },
    renderElement("div", { class: "qmd-chart-fn-var-head" },
      nameField(v, index, reserved, get, set),
      renderElement("span", { class: "qmd-chart-fn-rel", "aria-hidden": "true", text: "=" }),
      value,
      renderElement("label", { class: "qmd-chart-check-field" }, toggle, renderElement("span", { text: "Slider" })),
      remove),
    slider);
  if (hasSlider) row.append(renderElement("div", { class: "qmd-chart-fn-var-bounds" }, boundField(v, "min", "Min", index, get, set), boundField(v, "max", "Max", index, get, set), boundField(v, "step", "Step", index, get, set)));
  return row;
}

type SetModel = (next: ChartModel, rebuild?: "rows" | "vars" | null) => void;

const withFns = (model: ChartModel, fns: ChartFn[]): ChartModel => ({ ...model, fns });

/** The first bad expression of each function, from the sampler of the editor's dimension. */
function rowErrors(model: ChartModel, dims: 2 | 3): FnRowError[] {
  if (dims === 3) return model.fns.map((fn) => fnTraces3d(fn, model.vars, model.layout.colorscale ?? DEFAULT_COLOURSCALE).error);
  const view = { x: model.layout.xaxis.range ?? DEFAULT_VIEW, y: model.layout.yaxis.range ?? DEFAULT_VIEW };
  return model.fns.map((fn, i) => fnTraces2d(fn, model.vars, view, fn.color ?? EXPORT_THEME.palette[i % EXPORT_THEME.palette.length] ?? "#888888").error);
}

/** The preview's figure: the chart on a white page, as the export draws it. */
function previewFigure(model: ChartModel): ChartFigure {
  const figure = chartFigure(model, null, EXPORT_THEME);
  return { data: figure.data, layout: { ...figure.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" } };
}

/** What the 3D preview reports: the dragged camera is stored without a redraw (Plotly already shows it); Reset view drops it. */
function sceneHooks(get: GetModel, store: (next: ChartModel) => void, set: SetModel): ScenePreviewOptions {
  return {
    onCamera: (camera) => store({ ...get(), layout: { ...get().layout, camera } }),
    onResetView: () => {
      if (get().layout.camera === undefined) return;
      const { camera: _camera, ...layout } = get().layout;
      set({ ...get(), layout });
    },
  };
}

/** The Expressions content: the '+ Add' menu of kinds, the function rows, 'Variables +' and the variable list. */
function mountExpressions(rows: FnRows, get: GetModel, set: SetModel, kinds: readonly { label: string; fn: ChartFn }[], reserved: ReadonlySet<string>): { el: HTMLElement; renderVars(): void } {
  const add = renderElement("button", { class: "ls-btn qmd-chart-fn-add", type: "button", "aria-haspopup": "menu", text: "+ Add" });
  add.addEventListener("click", () => {
    showMenu(add, kinds.map((k) => ({
      label: k.label,
      onSelect: () => {
        set(withFns(get(), [...get().fns, { ...k.fn, expr: [...k.fn.expr] }]), "rows");
        rows.focusRow(get().fns.length - 1);
      },
    })));
  });
  const varList = renderElement("ul", { class: "qmd-chart-fn-vars", "aria-label": "Variables" });
  const renderVars = (): void => {
    varList.replaceChildren(...get().vars.map((v, i) => varRow(v, i, reserved, get, (next, rebuild) => set(next, rebuild ? "vars" : null))));
  };
  const addVar = renderElement("button", { class: "ls-btn qmd-chart-fn-add", type: "button", text: "Variables +" });
  addVar.addEventListener("click", () => {
    set({ ...get(), vars: [...get().vars, { name: freeName(get().vars, reserved), value: 1, ...NEW_SLIDER }] }, "vars");
    varList.querySelector<HTMLInputElement>("li:last-child .qmd-chart-fn-var-name")?.focus();
  });
  const el = renderElement("div", { class: "qmd-chart-panel qmd-chart-fn-expressions" },
    renderElement("div", { class: "qmd-chart-fn-bar" }, add),
    rows.el,
    renderElement("div", { class: "qmd-chart-fn-bar" }, addVar),
    varList);
  return { el, renderVars };
}

/** The panel of an axis tab, built from the model (X, Y and Z Axis keep one axis fieldset of the Axes panel); `set` gets the model with the edited axes.
 * In 3D the Axes panel always has the z axis and ends with the Colourscale select. */
function axesPanel(id: Exclude<Tab, "expressions">, model: ChartModel, dims: 2 | 3, set: (next: ChartModel) => void): HTMLElement {
  const shown = dims === 3 && model.layout.zaxis === undefined ? { ...model, layout: { ...model.layout, zaxis: { type: "linear" as const } } } : model;
  // The panel keeps its own copy of the model; take only its axes, so a camera or colourscale set meanwhile is kept.
  const axes = renderStylePanel("axes", shown, (next) => {
    const { xaxis, yaxis, zaxis } = next.layout;
    set({ ...model, layout: { ...model.layout, xaxis, yaxis, ...(zaxis !== undefined ? { zaxis } : {}) } });
  });
  if (id !== "axes") return axes.querySelectorAll<HTMLElement>("fieldset")[AXIS_INDEX[id]] ?? axes;
  if (dims === 3) {
    axes.append(selectField("Colourscale", [{ value: "", label: `Default (${DEFAULT_COLOURSCALE})` }, ...COLOURSCALES.map((s) => ({ value: s, label: s }))], model.layout.colorscale ?? "", (value) => {
      const { colorscale: _colorscale, ...layout } = model.layout;
      set({ ...model, layout: value === "" ? layout : { ...layout, colorscale: value } });
    }));
  }
  return axes;
}

/** The rows' edits as new models: a changed function, a removal and a move rebuild nothing but the rows they reorder or drop. */
function rowHandlers(get: GetModel, set: SetModel): FnRowsHandlers {
  return {
    change: (index, fn) => set(withFns(get(), get().fns.map((f, i) => (i === index ? fn : f)))),
    remove: (index) => set(withFns(get(), get().fns.filter((_, i) => i !== index)), "rows"),
    move(from, to) {
      const fns = [...get().fns];
      const [moved] = fns.splice(from, 1);
      if (moved === undefined) return;
      fns.splice(to, 0, moved);
      set(withFns(get(), fns), "rows");
    },
  };
}

/** Runs `draw` at most once per animation frame however often `schedule` is called; `stop` cancels a pending frame for good. */
function frameScheduler(draw: () => void): { schedule(): void; stop(): void } {
  let frame: number | null = null;
  let stopped = false;
  return {
    schedule() {
      if (frame === null && !stopped) frame = requestAnimationFrame(() => { frame = null; if (!stopped) draw(); });
    },
    stop() {
      stopped = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
    },
  };
}

/** The function plot body in `root`; `onChange` gets each edited model. `dims` 3 offers the 3D kinds, the Z Axis tab, the colourscale and the stored camera. */
export function mountFnEditor(root: HTMLElement, model: ChartModel, onChange: (model: ChartModel) => void, loadPlotly: EditorPlotlyLoader, dims: 2 | 3): { update(model: ChartModel): void; destroy(): void } {
  let current = model;
  let tab: Tab = "expressions";
  const get = (): ChartModel => current;
  const panel = renderElement("div", { class: "qmd-chart-fn-panel", id: `qmd-chart-fn-panel-${++mountCount}` });
  const previewRoot = renderElement("div", { class: "qmd-chart-fn-preview" });
  const store = (next: ChartModel): void => { current = next; onChange(next); };
  const preview = mountChartPreview(previewRoot, loadPlotly, dims === 3 ? sceneHooks(get, store, (next) => set(next)) : undefined);
  /** Resamples the preview and refreshes the rows' errors, once for every edit of a frame. */
  const frames = frameScheduler(() => {
    rows.showErrors(rowErrors(current, dims));
    preview.draw(previewFigure(current));
  });
  const set: SetModel = (next, rebuild = null) => {
    store(next);
    if (rebuild === "rows") rows.render(current.fns);
    if (rebuild === "vars") expressions.renderVars();
    frames.schedule();
  };
  const rows = mountFnRows(EXPORT_THEME.palette, rowHandlers(get, set));
  const expressions = mountExpressions(rows, get, set, dims === 3 ? KINDS_3D : KINDS_2D, dims === 3 ? RESERVED_3D : RESERVED_2D);
  const showTab = (id: Tab): void => {
    tab = id;
    panel.replaceChildren(id === "expressions" ? expressions.el : axesPanel(id, current, dims, (next) => set(next)));
  };
  const tabs = mountPageTabs(panel, { label: "Function plot", tabs: dims === 3 ? TABS_3D : TABS, selected: tab, onSelect: (id) => showTab(id as Tab) });
  root.append(renderElement("div", { class: "qmd-chart-fn-editor" }, renderElement("div", { class: "qmd-chart-fn-side" }, tabs.el, panel), previewRoot));
  rows.render(current.fns);
  expressions.renderVars();
  showTab(tab);
  frames.schedule();

  return {
    update(next) {
      current = next;
      rows.render(current.fns);
      expressions.renderVars();
      if (tab !== "expressions") showTab(tab);
      frames.schedule();
    },
    destroy() {
      frames.stop();
      closeMenu();
      preview.destroy();
      root.replaceChildren();
    },
  };
}
