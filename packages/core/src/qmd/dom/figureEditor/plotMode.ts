// The functions mode of the figure editor: functions, parameters and panel organization on the left; 2D / 3D / Both in the
// header; a toolbar (select or pan, + Panel, Axes, Grid, Fit); the panels on the stage, side by side or stacked; the function
// inspector; a status bar naming the visible functions, the panels and what each parameter controls.
import { renderElement, showToast, wsButton, wsCheck, wsSegmented, wsToggle } from "../../../ui/dom/index.js";
import { emptyLayout, type ChartFn, type ChartVar, type FigureModel, type FigurePanel } from "../../chart/index.js";
import { chartFigureParts, figurePgf } from "./chartParts.js";
import { FN_VARS, fnName, isFn3d } from "./fnTex.js";
import type { FigureMode, ModeContext } from "./modeTypes.js";
import { renderPlotInspector, type PlotTab } from "./plotInspector.js";
import { renderPlotPanels, type PlotPanelActions } from "./plotPanels.js";
import { mountPlotStage, type PanelFilter, type PlotStageView } from "./plotStage.js";

const PARAM_NAMES = ["a", "b", "c", "k", "m", "n", "s", "w"];
const RESERVED = new Set(Object.values(FN_VARS).flat().concat(["e", "pi"]));
/** How long one sweep of a playing parameter from its min to its max takes. */
const SWEEP_MS = 4000;

const panelsOf = (model: FigureModel): FigurePanel[] => model.panels ?? [{ dims: 2, layout: emptyLayout(2) }];

/** The function + Expression adds to a panel of the dimension. */
const starter = (dims: 2 | 3): ChartFn => (dims === 3 ? { kind: "surface", expr: ["sin(sqrt(x^2+y^2))"], domain: [-6, 6], domain2: [-6, 6], render: "both" } : { kind: "y", expr: ["sin(x)"] });

/** The function with its panel set (0 is written as no panel). */
function onPanel(fn: ChartFn, panel: number): ChartFn {
  const { panel: _p, ...rest } = fn;
  return panel === 0 ? rest : { ...rest, panel };
}

/** The model with panel `removed` gone: its functions go to the first other panel of their dimension, or go too; later panels shift down. */
function withoutPanel(model: FigureModel, removed: number): FigureModel {
  const panels = panelsOf(model);
  const dims = panels[removed]!.dims;
  const target = panels.findIndex((p, i) => i !== removed && p.dims === dims);
  const shift = (i: number): number => (i > removed ? i - 1 : i);
  const fns = model.fns.flatMap((fn) => {
    const at = fn.panel ?? 0;
    if (at !== removed) return [onPanel(fn, shift(at))];
    return target < 0 ? [] : [onPanel(fn, shift(target))];
  });
  return { ...model, fns, panels: panels.filter((_, i) => i !== removed) };
}

/** Every function in the first panel of its dimension, and the panels left empty removed. */
function overlaid(model: FigureModel): FigureModel {
  const panels = panelsOf(model);
  const first = { 2: panels.findIndex((p) => p.dims === 2), 3: panels.findIndex((p) => p.dims === 3) };
  const keep = panels.flatMap((_, i) => (i === first[2] || i === first[3] ? [i] : []));
  const fns = model.fns.map((fn) => onPanel(fn, keep.indexOf(first[isFn3d(fn) ? 3 : 2])));
  return { ...model, fns, panels: keep.map((i) => panels[i]!) };
}

/** The parameters each function's expressions name, for the status bar: "a controls f and S". */
function controlsLine(model: FigureModel): string {
  return model.vars.map((v) => {
    const names = model.fns.flatMap((fn, i) => (fn.expr.some((e) => new RegExp(`\\b${v.name}\\b`).test(e)) ? [fnName(fn, i, model.fns)] : []));
    return names.length > 0 ? `${v.name} controls ${names.join(" and ")}` : "";
  }).filter(Boolean).join(" · ");
}

export function createPlotMode(ctx: ModeContext): FigureMode {
  const { shell, host } = ctx;
  let selected: number | null = ctx.model().fns.length > 0 ? 0 : null;
  let tab: PlotTab = "function";
  const view: PlotStageView = { filter: "both", focus: null, axes: true, drag: "zoom", projection: "perspective" };
  let playing: { name: string; frame: number } | null = null;

  const change = (next: FigureModel): void => { ctx.change(next); refresh(); };
  const setFns = (fns: ChartFn[]): void => change({ ...ctx.model(), fns });
  const setPanels = (panels: FigurePanel[]): void => change({ ...ctx.model(), panels });
  const setVar = (name: string, value: number, light = false): void => {
    const next = { ...ctx.model(), vars: ctx.model().vars.map((v): ChartVar => (v.name === name ? { ...v, value: Math.round(value * 1000) / 1000 } : v)) };
    if (light) { ctx.change(next); stage.render(next, view); } else change(next);
  };
  const stop = (): void => { if (playing) { cancelAnimationFrame(playing.frame); playing = null; refresh(); } };
  const play = (name: string): void => {
    if (playing?.name === name) { stop(); return; }
    stop();
    const v = ctx.model().vars.find((x) => x.name === name);
    if (!v) return;
    const [min, max] = [v.min ?? -10, v.max ?? 10];
    const start = performance.now() - ((v.value - min) / (max - min || 1)) * SWEEP_MS;
    const tick = (now: number): void => { if (!playing) return; setVar(name, min + (((now - start) % SWEEP_MS) / SWEEP_MS) * (max - min), true); playing.frame = requestAnimationFrame(tick); };
    playing = { name, frame: requestAnimationFrame(tick) };
  };

  const actions: PlotPanelActions = {
    select: (i) => { selected = i; refresh(); },
    toggle: (i) => setFns(ctx.model().fns.map((fn, j) => (j !== i ? fn : fn.hidden === true ? (({ hidden: _h, ...rest }) => rest)(fn) : { ...fn, hidden: true }))),
    addExpression: () => {
      const model = ctx.model();
      const panel = selected !== null ? model.fns[selected]?.panel ?? 0 : Math.max(0, panelsOf(model).findIndex((p, i) => view.focus === null || view.focus === i));
      selected = model.fns.length;
      setFns([...model.fns, onPanel(starter(panelsOf(model)[panel]?.dims ?? 2), panel)]);
    },
    addParameter: () => {
      const model = ctx.model();
      const name = PARAM_NAMES.find((n) => !RESERVED.has(n) && !model.vars.some((v) => v.name === n));
      if (!name) { showToast("Every short parameter name is taken.", "info"); return; }
      change({ ...model, vars: [...model.vars, { name, value: 1, min: 0.1, max: 3, step: 0.1 }] });
    },
    setPanel: (i, panel) => setFns(ctx.model().fns.map((fn, j) => (j === i ? onPanel(fn, panel) : fn))),
    move: (i, d) => { const fns = [...ctx.model().fns]; const to = i + d; if (to < 0 || to >= fns.length) return; [fns[i], fns[to]] = [fns[to]!, fns[i]!]; selected = to; setFns(fns); },
    duplicate: (i) => { const fns = [...ctx.model().fns]; const { name: _n, ...copy } = fns[i]!; fns.splice(i + 1, 0, copy); selected = i + 1; setFns(fns); },
    remove: (i) => { selected = null; setFns(ctx.model().fns.filter((_, j) => j !== i)); },
    setVar: (name, value) => setVar(name, value),
    removeVar: (name) => { if (playing?.name === name) stop(); change({ ...ctx.model(), vars: ctx.model().vars.filter((v) => v.name !== name) }); },
    play,
    overlay: () => change(overlaid(ctx.model())),
    newPanel: () => setPanels([...panelsOf(ctx.model()), { dims: 2, layout: emptyLayout(2) }]),
  };

  const stage = mountPlotStage(shell.stage, host.loadPlotly, {
    focus: (panel) => { view.focus = panel; refresh(); },
    removePanel: (panel) => { view.focus = null; selected = null; change(withoutPanel(ctx.model(), panel)); },
    switchDims: (panel) => {
      if (ctx.model().fns.some((fn) => (fn.panel ?? 0) === panel)) { showToast("Move or remove the panel's functions first.", "info"); return; }
      const dims = panelsOf(ctx.model())[panel]!.dims === 3 ? 2 : 3;
      setPanels(panelsOf(ctx.model()).map((p, i) => (i === panel ? { dims, layout: emptyLayout(dims) } : p)));
    },
    camera: (panel, camera) => setPanels(panelsOf(ctx.model()).map((p, i) => (i !== panel ? p : { ...p, layout: camera === null ? (({ camera: _c, ...rest }) => rest)(p.layout) : { ...p.layout, camera } }))),
    projection: (mode) => { view.projection = mode; refresh(); },
  });

  const filter = wsSegmented([{ id: "2d", label: "2D" }, { id: "3d", label: "3D" }, { id: "both", label: "Both" }], view.filter, (id) => { view.filter = id as PanelFilter; refresh(); });
  shell.setCenter(filter.element);
  const grid = wsToggle("Grid", true, (on) => setPanels(panelsOf(ctx.model()).map((p) => ({ ...p, layout: { ...p.layout, xaxis: { ...p.layout.xaxis, grid: on }, yaxis: { ...p.layout.yaxis, grid: on } } }))), "grid");
  shell.toolbar.replaceChildren(
    wsSegmented([{ id: "zoom", label: "Select", icon: "pointer" }, { id: "pan", label: "Pan", icon: "hand" }], view.drag, (id) => { view.drag = id as "zoom" | "pan"; refresh(); }, "fe-tools").element,
    renderElement("span", { class: "ws-toolbar-sep" }), wsButton({ icon: "add", label: "Panel", showLabel: true }, () => actions.newPanel(), { variant: "outline" }),
    renderElement("span", { class: "ws-toolbar-sep" }), wsToggle("Axes", view.axes, (on) => { view.axes = on; refresh(); }, "axes").element, grid.element,
    renderElement("span", { class: "ws-spacer" }), wsButton({ icon: "screen-full", label: "Fit", showLabel: true }, () => stage.fit(), { variant: "outline" }));
  const arrange = wsSegmented([{ id: "row", label: "Side by side", icon: "split-horizontal" }, { id: "column", label: "Stacked", icon: "split-vertical" }], ctx.model().arrange ?? "row", (id) => change({ ...ctx.model(), arrange: id as "row" | "column" }));
  shell.bottom.hidden = false;
  shell.bottom.classList.add("fe-bottom-bar");
  shell.bottom.replaceChildren(arrange.element);

  function refresh(): void {
    const model = ctx.model();
    if (selected !== null && selected >= model.fns.length) selected = null;
    renderPlotPanels(shell.left, model, selected, host.loadMath, actions);
    renderPlotInspector(shell.inspector, { model, selected, tab, loadMath: host.loadMath }, { change, tab: (t) => { tab = t; refresh(); }, deselect: () => { selected = null; refresh(); },
      newPanelFor: (i) => { const panels = panelsOf(ctx.model()); const fn = ctx.model().fns[i]!; const dims = isFn3d(fn) ? 3 : 2; change({ ...ctx.model(), panels: [...panels, { dims, layout: emptyLayout(dims) }], fns: ctx.model().fns.map((f, j) => (j === i ? onPanel(f, panels.length) : f)) }); } });
    stage.render(model, view);
    const visible = model.fns.filter((fn) => fn.hidden !== true).length;
    const panels = panelsOf(model).length;
    shell.status.left.textContent = `${visible} visible ${visible === 1 ? "function" : "functions"} · ${panels} ${panels === 1 ? "panel" : "panels"}`;
    shell.status.center.textContent = controlsLine(model);
    shell.status.right.replaceChildren(wsCheck("Live update"));
  }
  refresh();

  return {
    async parts(model) { return { model, ...(await chartFigureParts(host.loadPlotly, model, null)) }; },
    code: async (model) => figurePgf(model, null) ?? `% No pgfplots picture: a figure of several panels is stored as an image.\n${JSON.stringify(model, null, 2)}`,
    destroy() { stop(); stage.destroy(); shell.setCenter(null); },
  };
}
