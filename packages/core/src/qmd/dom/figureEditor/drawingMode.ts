// The drawing mode of the figure editor: tools, ready-made shapes and objects on the left; a toolbar (undo, redo, Snap, Grid,
// Guides, then the selection's controls); the canvas on paper, with the selection's full properties in a panel floating over
// it instead of an inspector column; a status bar with the drawing's size, the tool's hint and its errors. Writes TikZ, SVG and PNG.
import { createWsInspector, renderElement, setPressed, showToast, wsButton, wsCheck, type WsInspector } from "../../../ui/dom/index.js";
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

/** Fits the shell to the drawing: the paper on the stage, no inspector column (the selection's properties open in a panel floating over the stage) and no bottom panel; `restore` puts the shell back. */
function layOutShell(shell: ModeContext["shell"], paper: HTMLElement): { props: WsInspector; propsCard: HTMLElement; restore(): void } {
  const props = createWsInspector();
  const propsCard = renderElement("div", { class: "fe-props" }, props.element);
  shell.stage.append(paper, propsCard);
  shell.stage.classList.add("fe-drawing-stage");
  shell.toolbar.classList.add("fe-drawing-toolbar");
  shell.bottom.hidden = true;
  shell.inspector.element.hidden = true;
  return {
    props, propsCard,
    restore() {
      propsCard.remove();
      shell.stage.classList.remove("fe-drawing-stage");
      shell.toolbar.classList.remove("fe-drawing-toolbar");
      shell.inspector.element.hidden = false;
    },
  };
}

/** The toolbar's fixed part: undo and redo, then Snap, Grid and Guides. */
function viewControls(paper: HTMLElement, canvas: () => DrawingCanvas): { fixed: HTMLElement[]; undo: HTMLButtonElement; redo: HTMLButtonElement } {
  const toggle = (cls: string) => (b: HTMLButtonElement): void => { const on = b.getAttribute("aria-pressed") !== "true"; setPressed(b, on); paper.classList.toggle(cls, !on); };
  const undo = wsButton({ icon: "discard", label: "Undo" }, () => canvas().undo());
  const redo = wsButton({ icon: "redo", label: "Redo" }, () => canvas().redo());
  const snap = wsButton({ icon: "magnet", label: "Snap", showLabel: true }, (b) => { const on = b.getAttribute("aria-pressed") !== "true"; setPressed(b, on); canvas().setSnap(on); }, { pressed: true, variant: "tool" });
  const grid = wsButton({ icon: "grid", label: "Grid", showLabel: true }, toggle("fe-no-grid"), { pressed: true, variant: "tool" });
  const guides = wsButton({ icon: "symbol-ruler", label: "Guides", showLabel: true }, toggle("fe-no-guides"), { pressed: true, variant: "tool" });
  return { fixed: [undo, redo, renderElement("span", { class: "ws-toolbar-sep" }), snap, grid, guides], undo, redo };
}

export function createDrawingMode(ctx: ModeContext): FigureMode {
  const { shell, host } = ctx;
  let tab: DrawingTab = "properties";
  const paper = renderElement("div", { class: "fe-paper fe-drawing-paper" });
  const { props, propsCard, restore } = layOutShell(shell, paper);
  let propsOpen = false;

  const press = (key: string): void => { paper.querySelector<HTMLElement>(".qmd-drawing-canvas")?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); };
  const { fixed, undo, redo } = viewControls(paper, () => canvas);

  let panels: DrawingPanels | null = null;
  const sync = (c: DrawingCanvas): void => {
    const { state } = c;
    const key = state.selection.size === 1 ? [...state.selection][0]! : null;
    if (state.model !== (ctx.model().drawing ?? EMPTY_DRAWING)) ctx.change({ ...ctx.model(), drawing: state.model });
    (panels ??= createDrawingPanels(shell.left, { tool: (tool) => c.setTool(tool), select: (k) => c.select(new Set([k])), insert: (t) => c.insert(t) })).update(state.model, state.tool, state.selection);
    propsCard.hidden = !propsOpen || key === null;
    if (!propsCard.hidden) renderDrawingInspector(props, { model: state.model, key, tab, loadMath: host.loadMath }, { edit: (model) => c.edit(model), tab: (t) => { tab = t; sync(c); }, deselect: () => { propsOpen = false; sync(c); } });
    undo.disabled = !c.canUndo();
    redo.disabled = !c.canRedo();
    // The selection's controls follow the fixed ones; they wait while a drag runs, so nothing is rebuilt under the pointer.
    const properties = { open: propsOpen, toggle: () => { propsOpen = !propsOpen; sync(c); } };
    if (!state.draft) shell.toolbar.replaceChildren(...fixed, ...(state.selection.size > 0 ? [renderElement("span", { class: "ws-toolbar-sep" }), drawingSelectionBar(c, () => { press("d"); }, () => press("Delete"), properties)] : []));
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
    destroy() { canvas.destroy(); restore(); },
  };
}
