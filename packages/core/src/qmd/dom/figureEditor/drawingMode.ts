// The drawing mode of the figure editor: tools and objects on the left; a toolbar (undo, redo, Snap, Grid, Guides, units); the
// canvas on paper with a floating bar over a selection (its kind, stroke colour, dash and width, duplicate, delete); the
// object inspector; a status bar with the drawing's size, the tool's hint, its TikZ and its errors. Writes TikZ, SVG and PNG.
import { renderElement, setPressed, showToast, wsButton, wsCheck, wsSelect } from "../../../ui/dom/index.js";
import { formatTikz, layoutDrawing, type DrawingModel } from "../../../drawing/index.js";
import { brokenSummary, mountDrawingCanvas, type DrawingCanvas } from "../drawingEditor/index.js";
import { renderDrawingParts } from "../drawingRender.js";
import { figureAlt } from "./chartParts.js";
import { renderDrawingInspector, type DrawingTab } from "./drawingInspector.js";
import { createDrawingPanels, drawingObjects, TOOLS, type DrawingPanels } from "./drawingPanels.js";
import { drawingSelectionBar } from "./drawingSelectionBar.js";
import type { FigureMode, ModeContext } from "./modeTypes.js";

/** CSS px per cm: the SVG is drawn at 96 px per inch. */
const PX_PER_CM = 96 / 2.54;
const EMPTY_DRAWING: DrawingModel = { v: 1, points: [], items: [] };

/** The SVG's px width as cm, the width the PNG is placed at. */
function svgWidthCm(svg: string): number {
  const px = Number(/^<svg\b[^>]*\swidth="(\d+(?:\.\d+)?)(?:px)?"/.exec(svg)?.[1]);
  return Number.isFinite(px) && px > 0 ? Math.round((px / PX_PER_CM) * 100) / 100 : 12;
}

/** The status bar: the figure's object count, the tool's hint, and what does not parse. */
function showStatus(ctx: ModeContext, c: DrawingCanvas): void {
  const { status } = ctx.shell;
  const count = drawingObjects(c.state.model).length;
  status.left.textContent = `${ctx.model().title ?? "Figure"} · ${count} ${count === 1 ? "object" : "objects"}`;
  status.center.textContent = TOOLS.find((t) => t.tool === c.state.tool)?.hint ?? "";
  const broken = brokenSummary(c.broken);
  status.right.replaceChildren(wsCheck(broken || "No errors", broken === ""));
}

/** The tool keys of the left panel (V, P, L, …) when the canvas has the focus; a shape being clicked out keeps its keys (Enter, digits). */
function attachToolKeys(canvas: DrawingCanvas): void {
  canvas.element.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || canvas.state.draft || (event.target as HTMLElement).closest("input, textarea, select")) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (tool) { event.preventDefault(); canvas.setTool(tool.tool); }
  });
}

export function createDrawingMode(ctx: ModeContext): FigureMode {
  const { shell, host } = ctx;
  let tab: DrawingTab = "properties";
  const view = { grid: true, guides: true };
  const paper = renderElement("div", { class: "fe-paper fe-drawing-paper" });
  const bar = renderElement("div", { class: "fe-selbar-slot" });
  shell.stage.append(bar, paper);
  shell.stage.classList.add("fe-drawing-stage");
  shell.bottom.hidden = true;

  const press = (key: string): void => { paper.querySelector<HTMLElement>(".qmd-drawing-canvas")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); };
  const undo = wsButton({ icon: "discard", label: "Undo" }, () => canvas.undo());
  const redo = wsButton({ icon: "redo", label: "Redo" }, () => canvas.redo());
  const snap = wsButton({ icon: "magnet", label: "Snap", showLabel: true }, (b) => { const on = b.getAttribute("aria-pressed") !== "true"; setPressed(b, on); canvas.setSnap(on); }, { pressed: true, variant: "tool" });
  const grid = wsButton({ icon: "grid", label: "Grid", showLabel: true }, (b) => { view.grid = !view.grid; setPressed(b, view.grid); paper.classList.toggle("fe-no-grid", !view.grid); }, { pressed: true, variant: "tool" });
  const guides = wsButton({ icon: "symbol-ruler", label: "Guides", showLabel: true }, (b) => { view.guides = !view.guides; setPressed(b, view.guides); paper.classList.toggle("fe-no-guides", !view.guides); }, { pressed: true, variant: "tool" });
  const units = wsSelect([{ value: "cm", label: "Units: cm" }], "cm", () => undefined, "Units");
  units.disabled = true;
  shell.toolbar.replaceChildren(undo, redo, renderElement("span", { class: "ws-toolbar-sep" }), snap, grid, guides, renderElement("span", { class: "ws-spacer" }), units);

  let panels: DrawingPanels | null = null;
  const sync = (c: DrawingCanvas): void => {
    const { state } = c;
    const key = state.selection.size === 1 ? [...state.selection][0]! : null;
    if (state.model !== (ctx.model().drawing ?? EMPTY_DRAWING)) ctx.change({ ...ctx.model(), drawing: state.model });
    (panels ??= createDrawingPanels(shell.left, { tool: (tool) => c.setTool(tool), select: (k) => c.select(new Set([k])), insert: (t) => c.insert(t) })).update(state.model, state.tool, state.selection);
    renderDrawingInspector(shell.inspector, { model: state.model, key, tab, loadMath: host.loadMath }, { edit: (model) => c.edit(model), tab: (t) => { tab = t; sync(c); }, deselect: () => c.select(new Set()) });
    undo.disabled = !c.canUndo();
    redo.disabled = !c.canRedo();
    // The bar waits while a drag runs, so its widgets are not rebuilt under the pointer on every move.
    if (!state.draft) bar.replaceChildren(...(state.selection.size > 0 ? [drawingSelectionBar(c, () => { press("d"); }, () => press("Delete"))] : []));
    showStatus(ctx, c);
  };
  const canvas = mountDrawingCanvas(paper, ctx.model().drawing ?? EMPTY_DRAWING, sync);
  attachToolKeys(canvas);
  sync(canvas);

  return {
    async parts(model) {
      if (canvas.broken.length > 0) { showToast(brokenSummary(canvas.broken), "error"); return null; }
      const drawing = canvas.final();
      const parts = await renderDrawingParts(drawing, host.loadMath);
      if (parts === null) { showToast("The drawing could not be painted.", "error"); return null; }
      const stored = { ...model, drawing };
      return { model: stored, png: { dataUrl: parts.png, widthCm: svgWidthCm(parts.svg), alt: figureAlt(stored) }, picture: parts.tikz, svg: parts.svg };
    },
    code: async () => { const drawing = canvas.final(); return formatTikz(drawing, layoutDrawing(drawing, () => ({ width: 10, height: 14 }))); },
    destroy() { canvas.destroy(); shell.stage.classList.remove("fe-drawing-stage"); },
  };
}
