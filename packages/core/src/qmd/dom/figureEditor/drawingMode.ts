// The drawing mode of the figure editor: tools and objects on the left; a toolbar (undo, redo, Snap, Grid, Guides, units); the
// canvas on paper with a floating bar over a selection (its kind, stroke colour, dash and width, duplicate, delete); the
// object inspector; a status bar with the drawing's size, the tool's hint, its TikZ and its errors. Writes TikZ, SVG and PNG.
import { renderElement, setPressed, showMenu, showToast, wsButton, wsCheck, wsColour, wsSelect } from "../../../ui/dom/index.js";
import { formatTikz, layoutDrawing, type DrawingModel, type DrawingStyle } from "../../../drawing/index.js";
import { brokenSummary, mountDrawingCanvas, type DrawingCanvas, type Tool } from "../drawingEditor/index.js";
import { renderDrawingParts } from "../drawingRender.js";
import { figureAlt } from "./chartParts.js";
import { renderDrawingInspector, type DrawingTab } from "./drawingInspector.js";
import { drawingObjects, renderDrawingPanels, TOOLS } from "./drawingPanels.js";
import type { FigureMode, ModeContext } from "./modeTypes.js";

/** CSS px per cm: the SVG is drawn at 96 px per inch. */
const PX_PER_CM = 96 / 2.54;
const HINTS: Partial<Record<Tool, string>> = {
  select: "Drag to move · Double-click to edit",
  point: "Click to place a point",
  line: "Drag from one point to another",
  arrow: "Drag from one point to another",
  circle: "Drag from the centre outwards",
  rect: "Drag from one corner to the other",
  function: "Click inside axes to plot a function",
  label: "Click to place a label",
};
const EMPTY_DRAWING: DrawingModel = { v: 1, points: [], items: [] };

/** The SVG's px width as cm, the width the PNG is placed at. */
function svgWidthCm(svg: string): number {
  const px = Number(/^<svg\b[^>]*\swidth="(\d+(?:\.\d+)?)(?:px)?"/.exec(svg)?.[1]);
  return Number.isFinite(px) && px > 0 ? Math.round((px / PX_PER_CM) * 100) / 100 : 12;
}

/** The style of the single selected item, or the style new items get. */
function selectedStyle(canvas: DrawingCanvas): DrawingStyle {
  const key = [...canvas.state.selection][0];
  const item = key && /^i\d+$/.test(key) ? canvas.state.model.items[Number(key.slice(1))] : undefined;
  return (item && "style" in item ? item.style : undefined) ?? canvas.state.style;
}

/** The floating bar over a selection: its kind, stroke colour, dash and width, duplicate and more. */
function selectionBar(canvas: DrawingCanvas, duplicate: () => void, remove: () => void): HTMLElement {
  const style = selectedStyle(canvas);
  const keys = [...canvas.state.selection];
  const name = keys.length === 1 ? drawingObjects(canvas.state.model).find((o) => o.key === keys[0])?.name.split(" ")[0] ?? "Object" : `${keys.length} objects`;
  const set = (next: DrawingStyle): void => canvas.setStyle(next);
  return renderElement("div", { class: "fe-selbar", role: "toolbar", "aria-label": "Selection" },
    renderElement("span", { class: "fe-selbar-chip", text: name }),
    wsColour(style.color ?? "#1f2328", (color) => set({ ...style, color }), "Stroke colour"),
    wsSelect([{ value: "solid", label: "———" }, { value: "dashed", label: "– – –" }, { value: "dotted", label: "· · · ·" }], style.dash ?? "solid", (d) => { const { dash: _d, ...rest } = style; set(d === "solid" ? rest : { ...rest, dash: d as "dashed" | "dotted" }); }, "Line style"),
    wsSelect([{ value: "normal", label: "0.4 pt" }, { value: "thick", label: "0.8 pt" }], style.thick ? "thick" : "normal", (w) => { const { thick: _t, ...rest } = style; set(w === "thick" ? { ...rest, thick: true } : rest); }, "Line width"),
    wsButton({ icon: "vs-copy", label: "Duplicate" }, duplicate),
    wsButton({ icon: "ellipsis", label: "More" }, (button) => showMenu(button, [{ label: "Delete", icon: "vs-trash", onSelect: remove }])));
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

  const sync = (c: DrawingCanvas): void => {
    const { state } = c;
    const key = state.selection.size === 1 ? [...state.selection][0]! : null;
    if (state.model !== (ctx.model().drawing ?? EMPTY_DRAWING)) ctx.change({ ...ctx.model(), drawing: state.model });
    renderDrawingPanels(shell.left, state.model, state.tool, state.selection, { tool: (tool) => c.setTool(tool), select: (k) => c.select(new Set([k])) });
    renderDrawingInspector(shell.inspector, { model: state.model, key, tab, loadMath: host.loadMath }, { edit: (model) => c.edit(model), tab: (t) => { tab = t; sync(c); }, deselect: () => c.select(new Set()) });
    undo.disabled = !c.canUndo();
    redo.disabled = !c.canRedo();
    bar.replaceChildren(...(state.selection.size > 0 ? [selectionBar(c, () => { press("d"); }, () => press("Delete"))] : []));
    const count = drawingObjects(state.model).length;
    shell.status.left.textContent = `${ctx.model().title ?? "Figure"} · ${count} ${count === 1 ? "object" : "objects"}`;
    shell.status.center.textContent = HINTS[state.tool] ?? "";
    const broken = brokenSummary(c.broken);
    shell.status.right.replaceChildren(wsCheck(broken || "No errors", broken === ""));
  };
  const canvas = mountDrawingCanvas(paper, ctx.model().drawing ?? EMPTY_DRAWING, sync);
  // The tool keys of the left panel (S, P, L, …) when the canvas has the focus.
  canvas.element.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey || (event.target as HTMLElement).closest("input, textarea, select")) return;
    const tool = TOOLS.find((t) => t.key.toLowerCase() === event.key.toLowerCase());
    if (tool) { event.preventDefault(); canvas.setTool(tool.tool); }
  });
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
