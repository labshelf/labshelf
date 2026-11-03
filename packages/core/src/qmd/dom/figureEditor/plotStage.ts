// The functions mode's stage: one card per panel (its title, how many functions it draws, focus and a menu over the plot; zoom
// and home in 2D, home and perspective in 3D under it), laid out side by side or stacked, filtered to 2D, 3D or both.
import { renderElement, showMenu, wsButton, wsSelect } from "../../../ui/dom/index.js";
import { chartFigure, EXPORT_THEME, panelCharts, type ChartFigure, type ChartLayout, type FigureModel } from "../../chart/index.js";
import type { EditorPlotlyLoader } from "./editorPlotly.js";
import { mountStagePlot, type StagePlot } from "./stagePlot.js";

export type PanelFilter = "2d" | "3d" | "both";

export interface PlotStageView { filter: PanelFilter; focus: number | null; axes: boolean; drag: "zoom" | "pan"; projection: "perspective" | "orthographic" }

export interface PlotStageActions {
  focus(panel: number | null): void;
  removePanel(panel: number): void;
  switchDims(panel: number): void;
  camera(panel: number, camera: NonNullable<ChartLayout["camera"]> | null): void;
  projection(mode: "perspective" | "orthographic"): void;
}

interface Card { element: HTMLElement; plot: StagePlot; title: HTMLElement; count: HTMLElement }

/** A panel's figure on white paper, with the axes lines shown or not and the view's projection in 3D. */
function panelFigure(model: FigureModel, panel: number, view: PlotStageView): ChartFigure {
  const chart = panelCharts(model)[panel]!;
  const figure = chartFigure(chart, null, EXPORT_THEME);
  const layout: Record<string, unknown> = { ...figure.layout, paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", margin: { l: 36, r: 12, t: 12, b: 32 } };
  for (const key of ["xaxis", "yaxis"]) if (layout[key]) layout[key] = { ...(layout[key] as object), zeroline: view.axes, zerolinecolor: "#1f2328", zerolinewidth: 1.4 };
  if (layout.scene) layout.scene = { ...(layout.scene as object), camera: { ...(chart.layout.camera ?? {}), projection: { type: view.projection } } };
  return { data: figure.data, layout };
}

function createCard(model: FigureModel, panel: number, loadPlotly: EditorPlotlyLoader, a: PlotStageActions, view: () => PlotStageView): Card {
  const dims = model.panels![panel]!.dims;
  const title = renderElement("strong", { class: "fe-panel-title" });
  const count = renderElement("span", { class: "fe-panel-count" });
  const menu = wsButton({ icon: "ellipsis", label: "Panel actions" }, (button) => showMenu(button, [
    { label: dims === 3 ? "Make it a 2D panel" : "Make it a 3D panel", icon: "package", onSelect: () => a.switchDims(panel) },
    { label: "Remove panel", icon: "vs-trash", disabled: (model.panels?.length ?? 0) <= 1, onSelect: () => a.removePanel(panel) },
  ]));
  const focus = wsButton({ icon: "screen-full", label: "Focus this panel" }, () => a.focus(view().focus === panel ? null : panel));
  const body = renderElement("div", { class: "fe-panel-body" });
  const plot = mountStagePlot(body, loadPlotly, dims === 3 ? { onCamera: (camera) => a.camera(panel, camera) } : {});
  const foot = dims === 3
    ? renderElement("div", { class: "fe-panel-foot" }, wsButton({ icon: "home", label: "Reset the camera" }, () => a.camera(panel, null), { variant: "outline" }),
        wsSelect([{ value: "perspective", label: "Perspective" }, { value: "orthographic", label: "Orthographic" }], view().projection, (p) => a.projection(p as "perspective" | "orthographic"), "Projection"), renderElement("span", { class: "ws-spacer" }), renderElement("span", { class: "fe-hint", text: "Drag to rotate" }))
    : renderElement("div", { class: "fe-panel-foot" }, renderElement("span", { class: "ws-spacer" }), wsButton({ icon: "zoom-out", label: "Zoom out" }, () => plot.zoom(-1), { variant: "outline" }),
        wsButton({ icon: "zoom-in", label: "Zoom in" }, () => plot.zoom(1), { variant: "outline" }), wsButton({ icon: "home", label: "Fit" }, () => plot.fit(), { variant: "outline" }));
  const element = renderElement("section", { class: "fe-panel" }, renderElement("header", { class: "fe-panel-head" }, title, renderElement("span", { class: "ws-spacer" }), count, focus, menu), body, foot);
  return { element, plot, title, count };
}

/** Mounts the stage; `render` redraws the cards for a figure and a view, `fit` fits every 2D panel. */
export function mountPlotStage(stage: HTMLElement, loadPlotly: EditorPlotlyLoader, a: PlotStageActions): { render(model: FigureModel, view: PlotStageView): void; fit(): void; destroy(): void } {
  const grid = renderElement("div", { class: "fe-panels" });
  stage.append(grid);
  let cards: Card[] = [];
  let shape = "";
  let view: PlotStageView = { filter: "both", focus: null, axes: true, drag: "zoom", projection: "perspective" };
  const rebuild = (model: FigureModel): void => {
    for (const card of cards) card.plot.destroy();
    cards = (model.panels ?? []).map((_, i) => createCard(model, i, loadPlotly, a, () => view));
    grid.replaceChildren(...cards.map((c) => c.element));
  };
  return {
    render(model, next) {
      view = next;
      const nextShape = (model.panels ?? []).map((p) => p.dims).join(",");
      if (nextShape !== shape) { shape = nextShape; rebuild(model); }
      grid.dataset["arrange"] = model.arrange ?? "row";
      cards.forEach((card, i) => {
        const dims = model.panels![i]!.dims;
        const shown = (next.focus === null || next.focus === i) && (next.filter === "both" || next.filter === `${dims}d`);
        card.element.hidden = !shown;
        card.title.textContent = `Panel ${i + 1} · ${dims}D`;
        const n = model.fns.filter((fn) => (fn.panel ?? 0) === i).length;
        card.count.textContent = `${n} ${n === 1 ? "function" : "functions"}`;
        card.plot.setDrag(next.drag);
        if (shown) card.plot.draw(panelFigure(model, i, next));
      });
    },
    fit: () => cards.forEach((card) => card.plot.fit()),
    destroy() { for (const card of cards) card.plot.destroy(); grid.remove(); },
  };
}
