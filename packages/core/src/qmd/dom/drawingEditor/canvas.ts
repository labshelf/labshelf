// The drawing editor's canvas: one SVG with the grid, the drawing as formatDrawingSvg renders it, the selection, the gesture in progress and the alignment guides; converts pointer positions to grid units and finds what is under them (hit testing). Positions are SVG attributes, everything else CSS classes: no style attribute anywhere (the webview CSP forbids them).
import { emptyLayout, parseExpr, PX_PER_UNIT, type DrawingLayout, type LabelBox, pointRefs, type DrawingModel, type Vec, polyPath, smoothPath, svgPathData, type Path } from "../../../drawing/index.js";
import { selectionHandles } from "./handles.js";
import { hitTest } from "./hit.js";
import { frameCorners, selectionFrame } from "./transform.js";
import { snapPosition, type SnapResult } from "./snap.js";
import { createEditorState, itemIndexOf, type Draft, type EditorState, type HitTarget } from "./state.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PX = PX_PER_UNIT;
/** Grid units the canvas extends past the furthest element. */
const MARGIN_UNITS = 2;
/** The least area an empty or small drawing gets to draw in. */
const MIN_WIDTH_UNITS = 16;
const MIN_HEIGHT_UNITS = 10;
const RING_R = 5;
/** Half the side, in px, of a handle's square. */
const HANDLE_R = 3.5;
/** Radius, in px, of a grid dot. */
const GRID_DOT_R = 0.9;
let nextGridId = 0;

type Pointer = { at: Vec; shift: boolean; alt: boolean };

export interface Canvas {
  readonly el: SVGSVGElement;
  /** Screen px per grid unit, as the canvas is shown now. */
  scale(): number;
  /** The grid position (y up) under a pointer event. */
  toGrid(event: MouseEvent): Vec;
  /** The grid position at the middle of what the canvas shows. */
  centre(): Vec;
  /** The handle, point, item or axes under a grid position in the drawing last rendered, or null. */
  hit(at: Vec): HitTarget | null;
  /** Redraws everything from the state, its layout and the drawing markup; `pointer` is the last pointer position and modifiers, for the guides of a gesture in progress. */
  render(state: EditorState, layout: DrawingLayout, markup: string, pointer: Pointer | null, measure: (tex: string) => LabelBox): void;
}

function n(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? "0" : String(rounded);
}

function svgEl(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) { el.setAttribute(key, typeof value === "number" ? n(value) : value); }
  return el;
}

/** Model y is up, SVG y is down. */
function screen(v: Vec): Vec {
  return { x: v.x * PX, y: -v.y * PX };
}

// ---- frame ----

/** The canvas viewBox, in px: the drawing's own viewBox and the selection's handles, widened to whole grid units plus the margin, at least the minimum area. */
function frame(drawing: Element | null, empty: boolean, handles: readonly Vec[]): { x: number; y: number; w: number; h: number } {
  const vb = (drawing?.getAttribute("viewBox") ?? "").split(/\s+/).map(Number);
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  if (!empty && vb.length === 4 && vb.every(Number.isFinite)) {
    const [x, y, w, h] = vb as [number, number, number, number];
    left = x / PX;
    right = (x + w) / PX;
    top = -y / PX;
    bottom = -(y + h) / PX;
  }
  for (const h of handles) {
    left = Math.min(left, h.x);
    right = Math.max(right, h.x);
    top = Math.max(top, h.y);
    bottom = Math.min(bottom, h.y);
  }
  left = Math.floor(left) - MARGIN_UNITS;
  right = Math.max(Math.ceil(right) + MARGIN_UNITS, left + MIN_WIDTH_UNITS);
  top = Math.ceil(top) + MARGIN_UNITS;
  bottom = Math.min(Math.floor(bottom) - MARGIN_UNITS, top - MIN_HEIGHT_UNITS);
  return { x: left * PX, y: -top * PX, w: (right - left) * PX, h: (top - bottom) * PX };
}

/** The drawing's SVG as DOM nodes without any `style` attribute (the webview CSP forbids them). */
function parseDrawing(markup: string): Element | null {
  const parsed = new DOMParser().parseFromString(markup, "text/html").querySelector("svg");
  if (!parsed) { return null; }
  for (const node of [parsed, ...Array.from(parsed.querySelectorAll("[style]"))]) { node.removeAttribute("style"); }
  return parsed;
}

// ---- broken labels and curves ----

/** Approximate px per character and line height of a broken label's source box. */
const SOURCE_CHAR_PX = 7;
const SOURCE_LINE_PX = 18;

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The renderLabel fallback for TeX that does not typeset: its source in a box the stylesheet draws red and dashed (class, no style=). */
export function brokenLabelMarkup(tex: string): string {
  const width = Math.max(1, tex.length) * SOURCE_CHAR_PX + 8;
  const height = SOURCE_LINE_PX;
  return `<svg class="qmd-drawing-label-error" width="${width}px" height="${height}px" viewBox="0 0 ${width} ${height}">`
    + `<rect class="qmd-drawing-error-box" x="0.5" y="0.5" width="${width - 1}" height="${height - 1}"></rect>`
    + `<text class="qmd-drawing-error-source" x="4" y="13">${escapeXml(tex)}</text></svg>`;
}

/** A red dashed box over the axes of each function whose expression does not parse, with the expression's source in it. */
function brokenCurves(model: DrawingModel, layout: DrawingLayout): SVGElement[] {
  const marks: SVGElement[] = [];
  model.items.forEach((item) => {
    if (item.k !== "fn" || parseExpr(item.expr).ok) { return; }
    const axes = layout.axes.get(item.axes);
    if (!axes) { return; }
    const a = screen(axes.from);
    const b = screen(axes.to);
    const group = svgEl("g", { class: "qmd-drawing-curve-error" });
    group.append(svgEl("rect", { class: "qmd-drawing-error-box", x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }));
    const text = svgEl("text", { class: "qmd-drawing-error-source", x: Math.min(a.x, b.x) + 4, y: Math.min(a.y, b.y) + 14 });
    text.textContent = item.expr;
    group.append(text);
    marks.push(group);
  });
  return marks;
}

// ---- overlays ----

/** The vertices clicked so far and the pointer, smooth for the Curve tool; the samples of a Pencil stroke as they came. */
function pathDraft(state: EditorState, end: Vec): Path {
  const clicked = (state.draft?.path ?? []).map((v) => v.at);
  if (state.tool === "freehand") { return polyPath(clicked, false); }
  const pts = [...clicked, end];
  return state.tool === "curve" ? smoothPath(pts, false) : polyPath(pts, false);
}

function draftShape(state: EditorState, draft: Draft, end: Vec, shift: boolean): SVGElement | null {
  const a = screen(draft.start);
  const b = screen(end);
  const box = (cls: string): SVGElement => svgEl("rect", { class: cls, x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
  switch (draft.kind) {
    case "move": return null;
    case "join": return svgEl("line", { class: "qmd-drawing-draft", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    case "marquee": return box("qmd-drawing-marquee");
    case "path": return svgEl("path", { class: "qmd-drawing-draft", d: svgPathData(pathDraft(state, end)) });
    case "handle": return null;
  }
}

/** The selection's handles: its transform box (a dashed outline, squares that stretch, a disc that turns, a slanted
 * square that slants) and the selected item's own (small squares, with a guide line to the point each belongs to). */
function handleMarks(state: EditorState): SVGElement[] {
  const frame = state.tool === "select" ? selectionFrame(state) : null;
  const outline = frame ? [svgEl("polygon", { class: "qmd-drawing-frame", points: frameCorners(frame).map((v) => { const p = screen(v); return `${n(p.x)},${n(p.y)}`; }).join(" ") })] : [];
  // While a drag runs the box follows the shape as an outline; its handles come back on release.
  if (state.draft) { return outline; }
  return [...outline, ...selectionHandles(state).flatMap((h) => {
    const at = screen(h.at);
    const r = HANDLE_R;
    const mark = h.kind === "rotate" ? svgEl("circle", { class: "qmd-drawing-handle is-rotate", cx: at.x, cy: at.y, r })
      : h.kind === "skew" ? svgEl("path", { class: "qmd-drawing-handle is-skew", d: `M${n(at.x - r)} ${n(at.y + r)}L${n(at.x)} ${n(at.y - r)}L${n(at.x + 2 * r)} ${n(at.y - r)}L${n(at.x + r)} ${n(at.y + r)}Z` })
      : svgEl("rect", { class: `qmd-drawing-handle${h.kind === "scale" ? " is-scale" : ""}`, x: at.x - r, y: at.y - r, width: 2 * r, height: 2 * r });
    if (!h.base) { return [mark]; }
    const base = screen(h.base);
    return [svgEl("line", { class: "qmd-drawing-handle-line", x1: base.x, y1: base.y, x2: at.x, y2: at.y }), mark];
  })];
}

function guideLines(guides: SnapResult["guides"], view: { x: number; y: number; w: number; h: number }): SVGElement[] {
  return guides.map((guide) => guide.axis === "v"
    ? svgEl("line", { class: "qmd-drawing-guide", x1: guide.at * PX, y1: view.y, x2: guide.at * PX, y2: view.y + view.h })
    : svgEl("line", { class: "qmd-drawing-guide", x1: view.x, y1: -guide.at * PX, x2: view.x + view.w, y2: -guide.at * PX }));
}

/** Rings on the selected points and on the points of the selected items; a dashed box on selected text. */
function selectionMarks(state: EditorState, measure: (tex: string) => LabelBox): SVGElement[] {
  const model = state.model;
  const ids = new Set<string>();
  const marks: SVGElement[] = [];
  for (const key of state.selection) {
    const index = itemIndexOf(key);
    if (index === null) { ids.add(key); continue; }
    const item = model.items[index];
    if (!item) { continue; }
    pointRefs(item).forEach((id) => ids.add(id));
    if (item.k === "text") {
      const box = measure(item.tex);
      const c = screen(item);
      marks.push(svgEl("rect", { class: "qmd-drawing-marquee", x: c.x - box.width / 2 - 2, y: c.y - box.height / 2 - 2, width: box.width + 4, height: box.height + 4 }));
    }
  }
  for (const p of model.points) {
    if (!ids.has(p.id)) { continue; }
    const c = screen(p);
    marks.push(svgEl("circle", { class: "qmd-drawing-ring", cx: c.x, cy: c.y, r: RING_R }));
  }
  return marks;
}

// ---- the canvas ----

type ViewBox = { x: number; y: number; w: number; h: number };

/** The canvas element and its layers: the grid pattern, the drawing and the overlay. */
function createLayers(): { el: SVGSVGElement; grid: SVGElement; drawing: SVGElement; overlay: SVGElement } {
  const el = svgEl("svg", { class: "qmd-drawing-canvas", tabindex: "0", role: "application", "aria-label": "Drawing canvas" }) as SVGSVGElement;
  const gridId = `qmd-drawing-grid-${nextGridId++}`;
  // A dot on every grid point: the tile is offset by half a unit so each dot sits whole at a tile's centre.
  const pattern = svgEl("pattern", { id: gridId, x: PX / 2, y: PX / 2, width: PX, height: PX, patternUnits: "userSpaceOnUse" });
  pattern.append(svgEl("circle", { class: "qmd-drawing-grid", cx: PX / 2, cy: PX / 2, r: GRID_DOT_R }));
  const defs = svgEl("defs");
  defs.append(pattern);
  const grid = svgEl("rect", { fill: `url(#${gridId})` });
  const drawing = svgEl("g", { class: "qmd-drawing-content" });
  const overlay = svgEl("g", { class: "qmd-drawing-overlay", fill: "none" });
  el.append(defs, grid, drawing, overlay);
  return { el, grid, drawing, overlay };
}

/** Screen px per grid unit. */
function screenScale(el: SVGSVGElement): number {
  const ctm = typeof el.getScreenCTM === "function" ? el.getScreenCTM() : null;
  return PX * (ctm ? Math.hypot(ctm.a, ctm.b) || 1 : 1);
}

function toGridAt(el: SVGSVGElement, event: { clientX: number; clientY: number }): Vec {
  const ctm = typeof el.getScreenCTM === "function" ? el.getScreenCTM() : null;
  const inv = ctm?.inverse();
  const x = inv ? inv.a * event.clientX + inv.c * event.clientY + inv.e : event.clientX;
  const y = inv ? inv.b * event.clientX + inv.d * event.clientY + inv.f : event.clientY;
  return { x: x / PX, y: -y / PX };
}

/** The draft shape at the snapped pointer and its guides; nothing without a draft. */
function draftMarks(state: EditorState, pointer: Pointer | null, scale: number, view: ViewBox): SVGElement[] {
  const draft = state.draft;
  if (!draft || !pointer) { return []; }
  const last = draft.path?.[draft.path.length - 1]?.at ?? draft.start;
  const snap = draft.kind === "marquee"
    ? { x: pointer.alt ? pointer.at.x : Math.round(pointer.at.x), y: pointer.alt ? pointer.at.y : Math.round(pointer.at.y), guides: [] }
    : draft.kind === "handle" ? { ...pointer.at, guides: [] }
    : snapPosition(state.model, { x: pointer.at.x, y: pointer.at.y, from: last, shift: pointer.shift, alt: pointer.alt, scale }, new Set(draft.ids ?? (draft.from !== undefined ? [draft.from] : [])));
  const shape = draftShape(state, draft, snap, pointer.shift);
  return [...(shape ? [shape] : []), ...guideLines(snap.guides, view)];
}

export function createCanvas(): Canvas {
  const { el, grid, drawing, overlay } = createLayers();
  let layout: DrawingLayout = emptyLayout();
  let shown: EditorState = createEditorState({ v: 1, points: [], items: [] });
  let lastView: ViewBox | null = null;
  let measureLabel: (tex: string) => LabelBox = () => ({ width: 0, height: 0 });
  const scale = (): number => screenScale(el);

  return {
    el,
    scale,
    toGrid: (event) => toGridAt(el, event),
    centre: () => (lastView ? { x: (lastView.x + lastView.w / 2) / PX, y: -(lastView.y + lastView.h / 2) / PX } : { x: 0, y: 0 }),
    hit: (at) => hitTest(shown, layout, at, scale(), measureLabel),
    render(state, nextLayout, markup, pointer, measure) {
      layout = nextLayout;
      shown = state;
      const model = state.model;
      measureLabel = measure;
      const parsed = parseDrawing(markup);
      // The view stays put while a drag runs, so the drawing never slides under the pointer; it fits the drawing again on release.
      const view = state.draft && lastView ? lastView : frame(parsed, model.points.length === 0 && model.items.length === 0, selectionHandles(state).map((h) => h.at));
      lastView = view;
      el.setAttribute("viewBox", `${n(view.x)} ${n(view.y)} ${n(view.w)} ${n(view.h)}`);
      el.setAttribute("width", n(view.w));
      el.setAttribute("height", n(view.h));
      el.setAttribute("class", `qmd-drawing-canvas is-${state.tool}`);
      for (const [key, value] of Object.entries({ x: view.x, y: view.y, width: view.w, height: view.h })) { grid.setAttribute(key, n(value)); }
      drawing.textContent = "";
      if (parsed) { for (const child of Array.from(parsed.childNodes)) { drawing.append(document.importNode(child, true)); } }
      overlay.textContent = "";
      overlay.append(...brokenCurves(model, layout), ...selectionMarks(state, measure), ...handleMarks(state), ...draftMarks(state, pointer, scale(), view));
    },
  };
}
