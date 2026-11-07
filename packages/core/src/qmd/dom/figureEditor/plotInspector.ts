// The functions mode's inspector: for the selected function a Function tab (kind, expression with its typeset form and
// validity, domain, the panel it is drawn in, move to a new panel, and in 3D rendering, colour, opacity and resolution, then
// the panel's axes and camera) and an Appearance tab (name, colour, visibility, opacity); with nothing selected, the figure.
import { renderElement, wsButton, wsCheck, wsColour, wsField, wsInput, wsNumber, wsRow, wsSection, wsSelect, wsSlider, wsToggle, type WsInspector } from "../../../ui/dom/index.js";
import type { ChartFn, ChartModel, FigureModel, FigurePanel } from "../../chart/index.js";
import type { MathLoader } from "../drawingEditor/index.js";
import { FN_VARS, fnError, fnName, fnTex, isFn3d, typeset } from "./fnTex.js";
import { fnColour, panelLabel } from "./plotPanels.js";
import { renderStylePanel } from "./stylePanels.js";

export type PlotTab = "function" | "appearance";

export interface PlotInspectorState { model: FigureModel; selected: number | null; tab: PlotTab; loadMath: MathLoader }
export interface PlotInspectorActions { change(next: FigureModel): void; tab(tab: PlotTab): void; deselect(): void; newPanelFor(index: number): void }

const KINDS_2D: readonly { kind: ChartFn["kind"]; label: string; parts: number }[] = [
  { kind: "y", label: "y = f(x)", parts: 1 }, { kind: "x", label: "x = f(y)", parts: 1 }, { kind: "param", label: "Parametric curve", parts: 2 },
  { kind: "polar", label: "Polar curve", parts: 1 }, { kind: "implicit", label: "Implicit curve", parts: 2 },
];
const KINDS_3D: readonly { kind: ChartFn["kind"]; label: string; parts: number }[] = [
  { kind: "surface", label: "z = f(x, y)", parts: 1 }, { kind: "param3d", label: "Parametric surface", parts: 3 }, { kind: "curve3d", label: "3D curve", parts: 3 },
];
const RENDER = [{ value: "both", label: "Surface + mesh" }, { value: "surface", label: "Surface" }, { value: "mesh", label: "Mesh" }];
const RESOLUTION = [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }];

function setFn(s: PlotInspectorState, a: PlotInspectorActions, index: number, fn: ChartFn): void {
  a.change({ ...s.model, fns: s.model.fns.map((f, i) => (i === index ? fn : f)) });
}

/** A copy of the function with `key` set, or removed when undefined. */
function withKey<K extends keyof ChartFn>(fn: ChartFn, key: K, value: ChartFn[K] | undefined): ChartFn {
  const { [key]: _old, ...rest } = fn;
  return (value === undefined ? rest : { ...rest, [key]: value }) as ChartFn;
}

/** The expression fields with the typeset function and its validity, which follow each keystroke before the change is kept. */
function expressionField(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement {
  const math = renderElement("div", { class: "ws-math" });
  const check = renderElement("div");
  const show = (draft: ChartFn): void => {
    void typeset(fnTex(draft, index, s.model.fns, s.model.vars), s.loadMath).then((node) => math.replaceChildren(node));
    const error = fnError(draft, s.model.vars);
    check.replaceChildren(wsCheck(error ?? "Valid expression", error === null));
  };
  let draft = fn;
  const inputs = fn.expr.map((text, part) => wsInput(text, () => setFn(s, a, index, draft), { mono: true, label: `Expression ${part + 1}`, onInput: (value) => { draft = { ...draft, expr: draft.expr.map((e, i) => (i === part ? value : e)) }; show(draft); } }));
  show(fn);
  const lead = renderElement("span", { class: "fe-expr-lead", text: `${fnName(fn, index, s.model.fns)}(${FN_VARS[fn.kind].slice(0, isFn3d(fn) && fn.kind === "surface" ? 2 : 1).join(",")}) =` });
  return wsField("Expression", renderElement("div", { class: "fe-expr" }, renderElement("div", { class: "fe-inline" }, lead, ...inputs), math, check));
}

/** From and To of one sampled variable (the function's domain or domain2). */
function domainRow(label: string, range: [number, number], set: (range: [number, number]) => void): HTMLElement {
  return wsRow(label, renderElement("span", { class: "fe-hint", text: "From" }), wsNumber(range[0], (lo) => set([lo, range[1]]), { label: `${label} from` }), renderElement("span", { class: "fe-hint", text: "To" }), wsNumber(range[1], (hi) => set([range[0], hi]), { label: `${label} to` }));
}

function domainSection(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement {
  const section = wsSection("Domain");
  const vars = FN_VARS[fn.kind];
  const first = fn.domain ?? [-6, 6];
  section.body.append(domainRow(vars[0] ?? "x", first, (domain) => setFn(s, a, index, { ...fn, domain })));
  if (fn.kind === "surface" || fn.kind === "param3d") section.body.append(domainRow(vars[1] ?? "y", fn.domain2 ?? first, (domain2) => setFn(s, a, index, { ...fn, domain2 })));
  return section.element;
}

/** The panel the function is drawn in, among those of its dimension, and Move to new panel. */
function viewSection(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement {
  const section = wsSection("View");
  const panels = (s.model.panels ?? []).flatMap((p, i) => ((p.dims === 3) === isFn3d(fn) ? [{ value: String(i), label: panelLabel(s.model, i) }] : []));
  section.body.append(wsSelect(panels, String(fn.panel ?? 0), (value) => setFn(s, a, index, withKey(fn, "panel", Number(value) || undefined)), "Panel"),
    wsButton({ icon: "vs-link", label: "Move to new panel", showLabel: true }, () => a.newPanelFor(index), { extra: "fe-link" }));
  return section.element;
}

function renderingSection(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement {
  const section = wsSection("Rendering");
  const set = (next: ChartFn): void => setFn(s, a, index, next);
  if (fn.kind !== "curve3d") section.body.append(wsSelect(RENDER, fn.render ?? "surface", (render) => set({ ...fn, render: render as ChartFn["render"] & string }), "Rendering"));
  section.body.append(
    wsRow("Colour", wsColour(fnColour(s.model, index), (color) => set({ ...fn, color }))),
    wsRow("Opacity", wsSlider(fn.opacity ?? 1, { min: 0.1, max: 1, step: 0.05 }, (opacity) => set({ ...fn, opacity }), "Opacity").element),
    wsRow("Resolution", wsSelect(RESOLUTION, fn.resolution ?? "medium", (r) => set({ ...fn, resolution: r as NonNullable<ChartFn["resolution"]> }), "Resolution")));
  return section.element;
}

/** The axes of the function's panel, edited as the chart it draws. */
function axesSection(fn: ChartFn, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement {
  const index = fn.panel ?? 0;
  const panel = s.model.panels?.[index];
  const section = wsSection(isFn3d(fn) ? "Axes and camera" : "Axes", { collapsible: true, open: false });
  if (panel === undefined) return section.element;
  const chart: ChartModel = { v: 1, id: s.model.id, kind: panel.dims === 3 ? "fn3d" : "fn2d", traces: [], fns: [], vars: [], layout: panel.layout };
  section.body.append(renderStylePanel("axes", chart, (next) => {
    const panels = (s.model.panels ?? []).map((p, i): FigurePanel => (i === index ? { ...p, layout: next.layout } : p));
    a.change({ ...s.model, panels });
  }));
  return section.element;
}

function functionTab(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement[] {
  const kinds = isFn3d(fn) ? KINDS_3D : KINDS_2D;
  const kind = wsSelect(kinds.map((k) => ({ value: k.kind, label: k.label })), fn.kind, (value) => {
    const next = kinds.find((k) => k.kind === value)!;
    setFn(s, a, index, { ...fn, kind: next.kind, expr: Array.from({ length: next.parts }, (_, i) => fn.expr[i] ?? "") });
  }, "Kind");
  const main = wsSection("Function");
  main.body.append(wsField("Kind", kind), expressionField(fn, index, s, a));
  return [main.element, domainSection(fn, index, s, a), viewSection(fn, index, s, a), ...(isFn3d(fn) ? [renderingSection(fn, index, s, a)] : []), axesSection(fn, s, a)];
}

function appearanceTab(fn: ChartFn, index: number, s: PlotInspectorState, a: PlotInspectorActions): HTMLElement[] {
  const set = (next: ChartFn): void => setFn(s, a, index, next);
  const main = wsSection("Appearance");
  main.body.append(
    wsField("Name", wsInput(fn.name ?? "", (name) => set(withKey(fn, "name", name.trim() || undefined)), { placeholder: fnName(fn, index, s.model.fns), label: "Name" })),
    wsRow("Colour", wsColour(fnColour(s.model, index), (color) => set({ ...fn, color }))),
    wsRow("Opacity", wsSlider(fn.opacity ?? 1, { min: 0.1, max: 1, step: 0.05 }, (opacity) => set({ ...fn, opacity }), "Opacity").element),
    wsToggle("Show in the figure", fn.hidden !== true, (on) => set(withKey(fn, "hidden", on ? undefined : true))).element);
  return [main.element];
}

/** Fills the inspector for the state. */
export function renderPlotInspector(inspector: WsInspector, s: PlotInspectorState, a: PlotInspectorActions): void {
  const fn = s.selected === null ? undefined : s.model.fns[s.selected];
  if (fn === undefined || s.selected === null) {
    inspector.show({ title: "Figure", icon: "sine" });
    const main = wsSection("Figure");
    main.body.append(wsField("Title", wsInput(s.model.title ?? "", (title) => { const { title: _t, ...rest } = s.model; a.change(title.trim() ? { ...rest, title: title.trim() } : rest); }, { label: "Title" })));
    inspector.body.replaceChildren(main.element, renderElement("p", { class: "ws-empty", text: "Select a function to edit it." }));
    return;
  }
  const index = s.selected;
  const title = `${isFn3d(fn) ? "Surface" : "Function"} ${fnName(fn, index, s.model.fns)}`;
  inspector.show({ title, swatch: fnColour(s.model, index), tabs: [{ id: "function", label: "Function" }, { id: "appearance", label: "Appearance" }], tab: s.tab, onTab: (id) => a.tab(id as PlotTab), onClose: a.deselect });
  inspector.body.replaceChildren(...(s.tab === "function" ? functionTab(fn, index, s, a) : appearanceTab(fn, index, s, a)));
}
