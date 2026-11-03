// The functions mode's left panel: the function list (visibility, colour, the typeset function, the panel it is drawn in, a
// menu) with + Expression and Parameter; the parameters (value, play, slider between its bounds); and Organization (overlay
// the functions in one panel, or add a panel).
import { renderElement, showMenu, wsButton, wsListRow, wsNumber, wsSection, wsSelect, wsSlider, type MenuEntry } from "../../../ui/dom/index.js";
import { EXPORT_THEME, type ChartVar, type FigureModel } from "../../chart/index.js";
import type { MathLoader } from "../mathView.js";
import { fnTex, isFn3d, typeset } from "./fnTex.js";

export interface PlotPanelActions {
  select(index: number): void;
  toggle(index: number): void;
  addExpression(): void;
  addParameter(): void;
  setPanel(index: number, panel: number): void;
  move(index: number, delta: -1 | 1): void;
  duplicate(index: number): void;
  remove(index: number): void;
  setVar(name: string, value: number): void;
  removeVar(name: string): void;
  play(name: string): void;
  overlay(): void;
  newPanel(): void;
}

export const fnColour = (model: FigureModel, index: number): string => model.fns[index]?.color ?? EXPORT_THEME.palette[index % EXPORT_THEME.palette.length]!;

export const panelLabel = (model: FigureModel, panel: number): string => `${model.panels?.[panel]?.dims === 3 ? "3D" : "2D"} · Panel ${panel + 1}`;

function fnMenu(index: number, count: number, a: PlotPanelActions): MenuEntry[] {
  return [
    { label: "Move up", icon: "arrow-up", disabled: index === 0, onSelect: () => a.move(index, -1) },
    { label: "Move down", icon: "chevron-down", disabled: index === count - 1, onSelect: () => a.move(index, 1) },
    { label: "Duplicate", icon: "vs-copy", onSelect: () => a.duplicate(index) },
    { label: "Remove", icon: "vs-trash", onSelect: () => a.remove(index) },
  ];
}

/** One function's row: the typeset function over the select of the panels of its dimension. */
function fnRow(model: FigureModel, index: number, selected: number | null, loadMath: MathLoader, a: PlotPanelActions): HTMLElement {
  const fn = model.fns[index]!;
  const math = renderElement("span", { class: "fe-fn-math", text: fn.expr.join(", ") || "…" });
  void typeset(fnTex(fn, index, model.fns, model.vars), loadMath).then((node) => math.replaceChildren(node));
  const panels = (model.panels ?? []).flatMap((p, i) => ((p.dims === 3) === isFn3d(fn) ? [{ value: String(i), label: panelLabel(model, i) }] : []));
  const panel = wsSelect(panels, String(fn.panel ?? 0), (value) => a.setPanel(index, Number(value)), "Panel");
  panel.classList.add("fe-fn-panel");
  const label = renderElement("span", { class: "fe-fn-label" }, math, panel);
  const menu = wsButton({ icon: "ellipsis", label: "Function actions" }, (button) => showMenu(button, fnMenu(index, model.fns.length, a)));
  return wsListRow({ label, swatch: fnColour(model, index), visible: fn.hidden !== true, selected: selected === index, trailing: [menu] }, { select: () => a.select(index), toggle: () => a.toggle(index) });
}

function functionsSection(model: FigureModel, selected: number | null, loadMath: MathLoader, a: PlotPanelActions): HTMLElement {
  const section = wsSection("Functions", { actions: [wsButton({ icon: "add", label: "Add function" }, () => a.addExpression())] });
  const buttons = renderElement("div", { class: "fe-button-row" },
    wsButton({ icon: "add", label: "Expression", showLabel: true }, () => a.addExpression(), { variant: "outline", extra: "fe-primary-outline" }),
    wsButton({ icon: "symbol-ruler", label: "Parameter", showLabel: true }, () => a.addParameter(), { variant: "outline" }));
  const list = renderElement("div", { class: "ws-list", role: "listbox", "aria-label": "Functions" }, ...model.fns.map((_, i) => fnRow(model, i, selected, loadMath, a)));
  section.body.append(buttons, list, wsButton({ icon: "add", label: "Add function", showLabel: true }, () => a.addExpression(), { extra: "ws-add" }));
  return section.element;
}

/** One parameter: `name =` and its value, play, remove, then the slider between its bounds. */
function parameterRow(v: ChartVar, a: PlotPanelActions): HTMLElement {
  const range = { min: v.min ?? -10, max: v.max ?? 10, step: v.step ?? 0.1 };
  const value = wsNumber(v.value, (n) => a.setVar(v.name, n), { step: range.step, label: `${v.name} value` });
  const head = renderElement("div", { class: "fe-param-head" }, renderElement("span", { class: "fe-param-name", text: `${v.name} =` }), value, renderElement("span", { class: "ws-spacer" }),
    wsButton({ icon: "debug-start", label: `Play ${v.name}` }, () => a.play(v.name), { variant: "outline" }), wsButton({ icon: "close", label: `Remove ${v.name}` }, () => a.removeVar(v.name)));
  const slider = wsSlider(v.value, range, (n) => { value.value = String(n); a.setVar(v.name, n); }, `${v.name} slider`);
  slider.element.querySelector(".ws-number")?.remove();
  const bounds = renderElement("div", { class: "fe-param-bounds" }, renderElement("span", { text: String(range.min) }), renderElement("span", { text: String(range.max) }));
  return renderElement("div", { class: "fe-param" }, head, slider.element, bounds);
}

function parametersSection(model: FigureModel, a: PlotPanelActions): HTMLElement {
  const section = wsSection("Parameters", { collapsible: true });
  if (model.vars.length === 0) section.body.append(renderElement("p", { class: "fe-hint", text: "A name in an expression that is not x, y or t becomes a parameter once added here." }));
  section.body.append(...model.vars.map((v) => parameterRow(v, a)));
  return section.element;
}

function organizationSection(a: PlotPanelActions): HTMLElement {
  const section = wsSection("Organization", { collapsible: true });
  section.body.append(
    wsButton({ icon: "vs-layers", label: "Overlay in one panel", showLabel: true }, () => a.overlay(), { variant: "outline", extra: "ws-add" }),
    wsButton({ icon: "add", label: "New panel", showLabel: true }, () => a.newPanel(), { variant: "outline", extra: "ws-add" }));
  return section.element;
}

/** Fills the left panel. */
export function renderPlotPanels(left: HTMLElement, model: FigureModel, selected: number | null, loadMath: MathLoader, a: PlotPanelActions): void {
  left.replaceChildren(functionsSection(model, selected, loadMath, a), parametersSection(model, a), organizationSection(a));
}
