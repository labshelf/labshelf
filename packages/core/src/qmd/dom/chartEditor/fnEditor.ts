// The function plot dialog (D9): tabs Expressions / Axes / X Axis / Y Axis beside a live preview with Zoom + / − and View full.
// Expressions holds the '+ Add' menu of kinds, the function rows (fnRows.ts) and 'Variables +' with each variable's value and optional slider.
// Every edit reports a new model at once; the preview resamples and the rows' errors are refreshed at most once per animation frame.
import { renderElement } from "../../../ui/dom/index.js";
import { closeMenu, showMenu } from "../../../ui/dom/widgets/menu.js";
import { mountPageTabs } from "../../../ui/dom/widgets/page.js";
import { chartFigure, type ChartFn, type ChartModel, type ChartVar } from "../../chart/index.js";
import { fnTraces2d } from "../../chart/sample2d.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";
import { EXPORT_THEME } from "./exportPng.js";
import { mountFnRows, type FnRowError } from "./fnRows.js";
import { mountChartPreview } from "./preview.js";
import { renderStylePanel } from "./stylePanels.js";

type Tab = "expressions" | "axes" | "x" | "y";

const TABS: readonly { id: Tab; label: string }[] = [
  { id: "expressions", label: "Expressions" }, { id: "axes", label: "Axes" }, { id: "x", label: "X Axis" }, { id: "y", label: "Y Axis" },
];

/** The kinds '+ Add' offers in 2D and the function each starts with. */
const KINDS_2D: readonly { label: string; fn: ChartFn }[] = [
  { label: "y = f(x)", fn: { kind: "y", expr: [""] } },
  { label: "x = f(y)", fn: { kind: "x", expr: [""] } },
  { label: "Inequality", fn: { kind: "y", rel: "<", expr: [""] } },
  { label: "Parametric curve", fn: { kind: "param", expr: ["", ""] } },
  { label: "Polar curve", fn: { kind: "polar", expr: [""] } },
  { label: "Implicit curve", fn: { kind: "implicit", expr: [""] } },
];

/** Names a variable cannot take: the plot's own variables and constants. */
const RESERVED = new Set(["x", "y", "t", "θ", "e", "pi"]);
const NAME = /^\p{L}+$/u;
const DEFAULT_VIEW: [number, number] = [-10, 10];
const NEW_SLIDER = { min: -10, max: 10, step: 0.1 };

let mountCount = 0;

/** Why `name` cannot name a variable, or null when it can. */
function nameProblem(name: string, others: readonly ChartVar[]): string | null {
  if (!NAME.test(name)) return "A variable name is letters only.";
  if (RESERVED.has(name)) return `${name} is taken by the plot; choose another name.`;
  if (others.some((v) => v.name === name)) return `${name} is already a variable.`;
  return null;
}

/** The first single letter free for a new variable. */
function freeName(vars: readonly ChartVar[]): string {
  for (const c of "abcdfghjklmnopqrsuvwz") if (!vars.some((v) => v.name === c)) return c;
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

/** One variable: name, value, an optional slider with its min, max and step, and remove. */
function varRow(v: ChartVar, index: number, get: () => ChartModel, set: (model: ChartModel, rebuild: boolean) => void): HTMLElement {
  const name = input({ type: "text", "aria-label": "Variable name", spellcheck: "false", class: "qmd-chart-input qmd-chart-fn-var-name" });
  name.value = v.name;
  const nameMessage = renderElement("div", { class: "qmd-chart-fn-message", role: "status" });
  nameMessage.hidden = true;
  name.addEventListener("change", () => {
    const next = name.value.trim();
    if (next === get().vars[index]?.name) return;
    const problem = nameProblem(next, get().vars.filter((_, i) => i !== index));
    name.classList.toggle("is-invalid", problem !== null);
    nameMessage.textContent = problem ?? "";
    nameMessage.hidden = problem === null;
    if (problem === null) set(setVar(get(), index, (x) => ({ ...x, name: next })), true);
  });
  const value = input({ type: "number", "aria-label": `Value of ${v.name}`, step: v.step ?? "any", class: "qmd-chart-input qmd-chart-fn-var-value" });
  value.value = String(v.value);
  const slider = input({ type: "range", "aria-label": `${v.name} slider`, min: v.min, max: v.max, step: v.step ?? "any", class: "qmd-chart-fn-slider" });
  const hasSlider = v.min !== undefined && v.max !== undefined;
  slider.hidden = !hasSlider;
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
  const toggle = renderElement("input", { class: "qmd-chart-check", type: "checkbox" });
  toggle.checked = hasSlider;
  toggle.addEventListener("change", () => {
    set(setVar(get(), index, (x) => {
      if (toggle.checked) return { ...x, min: Math.min(NEW_SLIDER.min, x.value), max: Math.max(NEW_SLIDER.max, x.value), step: NEW_SLIDER.step };
      const { min: _min, max: _max, step: _step, ...rest } = x;
      return rest;
    }), true);
  });
  const bound = (key: "min" | "max" | "step", label: string): HTMLInputElement => {
    const field = input({ type: "number", "aria-label": `${label} of the ${v.name} slider`, step: "any", class: "qmd-chart-input qmd-chart-fn-var-bound" });
    field.value = v[key] === undefined ? "" : String(v[key]);
    field.addEventListener("change", () => {
      const n = Number(field.value);
      if (field.value.trim() === "" || !Number.isFinite(n) || (key === "step" && n <= 0)) { field.value = v[key] === undefined ? "" : String(v[key]); return; }
      set(setVar(get(), index, (x) => ({ ...x, [key]: n })), true);
    });
    return field;
  };
  const remove = renderElement("button", { class: "ls-btn qmd-chart-fn-tool", type: "button", "aria-label": `Remove variable ${v.name}`, title: `Remove variable ${v.name}`, text: "×" });
  remove.addEventListener("click", () => set({ ...get(), vars: get().vars.filter((_, i) => i !== index) }, true));
  const row = renderElement("li", { class: "qmd-chart-fn-var" },
    renderElement("div", { class: "qmd-chart-fn-var-head" },
      renderElement("div", { class: "qmd-chart-fn-field" }, name, nameMessage),
      renderElement("span", { class: "qmd-chart-fn-rel", "aria-hidden": "true", text: "=" }),
      value,
      renderElement("label", { class: "qmd-chart-check-field" }, toggle, renderElement("span", { text: "Slider" })),
      remove),
    slider);
  if (hasSlider) row.append(renderElement("div", { class: "qmd-chart-fn-var-bounds" }, bound("min", "Min"), bound("max", "Max"), bound("step", "Step")));
  return row;
}

/** The function plot body in `root`; `onChange` gets each edited model. `dims` 3 is filled in later (6.2): it shows the 2D kinds for now. */
export function mountFnEditor(root: HTMLElement, model: ChartModel, onChange: (model: ChartModel) => void, loadPlotly: EditorPlotlyLoader, dims: 2 | 3): { update(model: ChartModel): void; destroy(): void } {
  let current = model;
  let tab: Tab = "expressions";
  let frame: number | null = null;
  let destroyed = false;
  const palette = EXPORT_THEME.palette;
  void dims; // the 3D kinds come with 6.2; until then the 2D ones are offered
  const kinds = KINDS_2D;

  const panel = renderElement("div", { class: "qmd-chart-fn-panel", id: `qmd-chart-fn-panel-${++mountCount}` });
  const previewRoot = renderElement("div", { class: "qmd-chart-fn-preview" });
  const preview = mountChartPreview(previewRoot, loadPlotly);

  /** Resamples the preview and refreshes the rows' errors, once for every edit of a frame. */
  const redraw = (): void => {
    frame = null;
    if (destroyed) return;
    const view = { x: current.layout.xaxis.range ?? DEFAULT_VIEW, y: current.layout.yaxis.range ?? DEFAULT_VIEW };
    const errors: FnRowError[] = current.fns.map((fn, i) => fnTraces2d(fn, current.vars, view, fn.color ?? palette[i % palette.length] ?? "#888888").error);
    rows.showErrors(errors);
    const figure = chartFigure(current, null, EXPORT_THEME);
    preview.draw({ data: figure.data, layout: { ...figure.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff" } });
  };
  const schedule = (): void => { if (frame === null && !destroyed) frame = requestAnimationFrame(redraw); };

  const setFns = (fns: ChartFn[]): ChartModel => ({ ...current, fns });
  const set = (next: ChartModel, rebuild: "rows" | "vars" | null = null): void => {
    current = next;
    onChange(next);
    if (rebuild === "rows") rows.render(current.fns);
    if (rebuild === "vars") renderVars();
    schedule();
  };

  const rows = mountFnRows(palette, {
    change: (index, fn) => set(setFns(current.fns.map((f, i) => (i === index ? fn : f)))),
    remove: (index) => set(setFns(current.fns.filter((_, i) => i !== index)), "rows"),
    move(from, to) {
      const fns = [...current.fns];
      const [moved] = fns.splice(from, 1);
      if (moved === undefined) return;
      fns.splice(to, 0, moved);
      set(setFns(fns), "rows");
    },
  });

  const add = renderElement("button", { class: "ls-btn qmd-chart-fn-add", type: "button", "aria-haspopup": "menu", text: "+ Add" });
  add.addEventListener("click", () => {
    showMenu(add, kinds.map((k) => ({
      label: k.label,
      onSelect: () => {
        set(setFns([...current.fns, { ...k.fn, expr: [...k.fn.expr] }]), "rows");
        rows.focusRow(current.fns.length - 1);
      },
    })));
  });

  const varList = renderElement("ul", { class: "qmd-chart-fn-vars", "aria-label": "Variables" });
  const renderVars = (): void => {
    varList.replaceChildren(...current.vars.map((v, i) => varRow(v, i, () => current, (next, rebuild) => set(next, rebuild ? "vars" : null))));
  };
  const addVar = renderElement("button", { class: "ls-btn qmd-chart-fn-add", type: "button", text: "Variables +" });
  addVar.addEventListener("click", () => {
    set({ ...current, vars: [...current.vars, { name: freeName(current.vars), value: 1, ...NEW_SLIDER }] }, "vars");
    varList.querySelector<HTMLInputElement>("li:last-child .qmd-chart-fn-var-name")?.focus();
  });

  const expressions = renderElement("div", { class: "qmd-chart-panel qmd-chart-fn-expressions" },
    renderElement("div", { class: "qmd-chart-fn-bar" }, add),
    rows.el,
    renderElement("div", { class: "qmd-chart-fn-bar" }, addVar),
    varList);

  /** The panel of a tab: the kept Expressions content, or an Axes panel built from the current model (X Axis and Y Axis keep one axis of it). */
  const showTab = (id: Tab): void => {
    tab = id;
    if (id === "expressions") { panel.replaceChildren(expressions); return; }
    const axes = renderStylePanel("axes", current, (next) => set(next));
    if (id === "axes") { panel.replaceChildren(axes); return; }
    const group = axes.querySelectorAll("fieldset")[id === "x" ? 0 : 1];
    panel.replaceChildren(group ?? axes);
  };
  const tabs = mountPageTabs(panel, { label: "Function plot", tabs: TABS, selected: tab, onSelect: (id) => showTab(id as Tab) });

  root.append(renderElement("div", { class: "qmd-chart-fn-editor" },
    renderElement("div", { class: "qmd-chart-fn-side" }, tabs.el, panel),
    previewRoot));
  rows.render(current.fns);
  renderVars();
  showTab(tab);
  schedule();

  return {
    update(next) {
      current = next;
      rows.render(current.fns);
      renderVars();
      if (tab !== "expressions") showTab(tab);
      schedule();
    },
    destroy() {
      destroyed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      closeMenu();
      preview.destroy();
      root.replaceChildren();
    },
  };
}
