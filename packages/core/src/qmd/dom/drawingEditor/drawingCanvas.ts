// The drawing canvas the figure editor's drawing mode drives (decisions D6 to D10): an SVG canvas inside the host, pointer and keyboard events
// turned into the pure editor events, the drawing re-rendered live through layout, its labels set by MathJax, undo and redo; the mode
// reads the state after each render to fill its panels, and sets the tool, the style, the selection and the model.
import * as coreMath from "../../../latex/hover/index.js";
import { renderElement } from "../../../ui/dom/index.js";
import { parseMathSvg, svgDimension } from "./mathSvg.js";
import { parseExpr, layoutDrawing, type LabelBox, type DrawingStyle, formatDrawingSvg } from "../../../drawing/index.js";
import { brokenLabelMarkup, createCanvas, type Canvas } from "./canvas.js";
import { applyEvent, shownModel, type EditorEvent } from "./gestures.js";
import { createLabelField, type LabelField } from "./labelField.js";
import { insertPlace, insertTemplate, type ShapeTemplate } from "./shapeLibrary.js";
import { createEditorState, createHistory, IdSource, itemIndexOf, type EditorHistory, type EditorState, type Tool } from "./state.js";

type MathApi = Awaited<ReturnType<typeof coreMath.loadCoreMath>>;
type DrawingModel = import("../../../drawing/index.js").DrawingModel;

/** The box a label gets while MathJax is still loading (svg.ts's default). */
const LOADING_LABEL: LabelBox = { width: 10, height: 14 };

/** Typeset labels kept per TeX source; cleared past this many. */
const TYPESET_CACHE = 500;

/** What labelField.ts works with: the live state, the elements it mounts in, `update` (a changed model is one undo step) and `preview` (shown live, no undo step: a field being typed in). */
export interface EditorSession { readonly state: EditorState; readonly root: HTMLElement; readonly canvas: SVGSVGElement; readonly scale: number; update(next: EditorState): void; preview(next: EditorState): void }

/** Something in the drawing that does not parse: a label's TeX or a function's expression. */
export interface Broken { kind: "label" | "expression"; source: string; message: string }

/** The math API of the latex/hover entry: through its loadCoreMath, or the entry itself when it is provided without one. */
function loadMath(): Promise<MathApi> {
  const entry = coreMath as Partial<typeof coreMath>;
  return typeof entry.loadCoreMath === "function" ? entry.loadCoreMath() : Promise.resolve(entry as MathApi);
}

/** Every TeX source the model shows as a label. */
function labelSources(model: DrawingModel): string[] {
  const out = model.points.flatMap((p) => p.label ? [p.label] : []);
  for (const item of model.items) {
    switch (item.k) {
      case "seg": case "fn": case "angle": if (item.label) { out.push(item.label); } break;
      case "text": if (item.tex) { out.push(item.tex); } break;
      case "axes": for (const tex of [item.xlabel, item.ylabel]) { if (tex) { out.push(tex); } } break;
      default: break;
    }
  }
  return out;
}

/** What the status bar says about the labels and expressions that do not parse; empty when there are none. */
export function brokenSummary(broken: readonly Broken[]): string {
  if (broken.length === 0) { return ""; }
  const parts = broken.map((b) => `${b.kind === "label" ? "Label" : "Expression"} ${b.source} does not parse${b.message ? ` (${b.message})` : ""}`);
  return `${parts.join("; ")}. Fix or undo it before the figure is written.`;
}

/** `obj` with `style` set, or without one when it is empty. */
function withStyle<T extends { style?: DrawingStyle }>(obj: T, style: DrawingStyle): T {
  const { style: _old, ...rest } = obj;
  return (Object.keys(style).length > 0 ? { ...rest, style: { ...style } } : rest) as T;
}

/** Applies a style to the selected items that carry one (all but labels and axes) and to the selected nodes. */
function restyleSelection(state: EditorState, style: DrawingStyle): EditorState {
  const indexes = new Set([...state.selection].map(itemIndexOf).filter((index): index is number => index !== null));
  const nodes = state.model.points.filter((p) => p.shape !== undefined && state.selection.has(p.id));
  if (indexes.size === 0 && nodes.length === 0) { return state; }
  const items = state.model.items.map((item, index) => (!indexes.has(index) || item.k === "text" || item.k === "axes" ? item : withStyle(item, style)));
  const points = nodes.length === 0 ? state.model.points : state.model.points.map((p) => (nodes.includes(p) ? withStyle(p, style) : p));
  return { ...state, model: { ...state.model, items, points } };
}

/** Two presses within this many ms and screen px of each other are a double press. */
const DOUBLE_MS = 500;
const DOUBLE_PX = 6;

/** The text of a thrown TeX error: its message, also when MathJax throws a plain object carrying one. */
function errorText(error: unknown): string {
  if (error instanceof Error) { return error.message; }
  if (typeof error === "object" && error !== null && typeof (error as { message?: unknown }).message === "string") { return (error as { message: string }).message; }
  return typeof error === "string" ? error : "";
}

const ESCAPE: EditorEvent = { type: "key", key: "Escape", shift: false, mod: false };


// ---- labels: typesetting and measuring ----

type Typeset = { markup: string; error: string | null };

/** Labels as MathJax typesets them, cached per TeX source; before setMath they measure as LOADING_LABEL and render as nothing. */
interface Labels { setMath(api: MathApi): void; typeset(tex: string): Typeset | null; render(tex: string): string; measure(tex: string): LabelBox }

function createLabels(): Labels {
  let math: MathApi | null = null;
  const cache = new Map<string, Typeset>();
  /** The label as style-free SVG markup, or its boxed source when MathJax rejects it; null while MathJax loads. */
  const typeset = (tex: string): Typeset | null => {
    if (!math) { return null; }
    const cached = cache.get(tex);
    if (cached) { return cached; }
    let out: Typeset;
    try {
      const svg = parseMathSvg(math.renderMathSvg(tex, false));
      svg.removeAttribute("style");
      out = { markup: svg.outerHTML, error: null };
    } catch (error) {
      out = { markup: brokenLabelMarkup(tex), error: errorText(error) };
    }
    if (cache.size >= TYPESET_CACHE) { cache.clear(); }
    cache.set(tex, out);
    return out;
  };
  const render = (tex: string): string => typeset(tex)?.markup ?? "";
  return {
    setMath: (api) => { math = api; },
    typeset,
    render,
    measure(tex) {
      if (!math) { return LOADING_LABEL; }
      const markup = render(tex);
      return { width: svgDimension(markup, "width"), height: svgDimension(markup, "height") };
    },
  };
}

function findBroken(labels: Labels, drawing: DrawingModel): Broken[] {
  const out: Broken[] = [];
  for (const source of new Set(labelSources(drawing))) {
    const error = labels.typeset(source)?.error;
    if (error !== undefined && error !== null) { out.push({ kind: "label", source, message: error }); }
  }
  for (const item of drawing.items) {
    if (item.k !== "fn") { continue; }
    const parsed = parseExpr(item.expr);
    if (!parsed.ok) { out.push({ kind: "expression", source: item.expr, message: parsed.error }); }
  }
  return out;
}

// ---- the open editor: session, history and rendering ----

/** Everything an open editor holds; the functions below act on it. */
interface Editor {
  history: EditorHistory;
  current: EditorState;
  closed: boolean;
  pointer: { at: { x: number; y: number }; shift: boolean; alt: boolean } | null;
  broken: Broken[];
  labelField: LabelField | null;
  /** The last press that may start a double press (client px), whether the current press is the second of one, and whether its double was already handled (so the browser's dblclick is not applied twice). */
  press: { last: { time: number; x: number; y: number } | null; second: boolean; handled: boolean };
  snap: boolean;
  readonly labels: Labels;
  readonly canvas: Canvas;
  readonly root: HTMLElement;
  readonly onRender: () => void;
}

function render(ed: Editor): void {
  const { labels, canvas } = ed;
  // A move or a handle drag shows the model as releasing there would leave it.
  const model = shownModel(ed.current, canvas.scale());
  const current = model === ed.current.model ? ed.current : { ...ed.current, model };
  const layout = layoutDrawing(model, labels.measure);
  canvas.render(current, layout, formatDrawingSvg(model, layout, labels.render), ed.pointer, labels.measure);
  ed.broken = findBroken(labels, current.model);
  ed.labelField?.sync();
  ed.onRender();
}

/** Shows `next` without recording an undo step: the text of a field being typed in. */
function preview(ed: Editor, next: EditorState): void {
  if (ed.closed) { return; }
  ed.current = next;
  render(ed);
}

/** Makes `next` the live state; a changed model is one undo step. */
function update(ed: Editor, next: EditorState): void {
  if (ed.closed) { return; }
  if (next.model !== ed.history.state.model) { ed.history = ed.history.push(next); }
  ed.current = next;
  render(ed);
}

function step(ed: Editor, direction: "undo" | "redo"): void {
  const moved = ed.history[direction]();
  if (ed.closed || moved === ed.history) { return; }
  ed.history = moved;
  ed.current = { ...moved.state, tool: ed.current.tool, style: ed.current.style, draft: null, editingLabel: null };
  render(ed);
}

/** Stops reacting; the DOM goes with destroy(). */
function teardown(ed: Editor): void {
  ed.closed = true;
  ed.labelField?.destroy();
}

// ---- pointer and keyboard input ----

function pointerEvent(ed: Editor, type: "down" | "move" | "up" | "dblclick", event: MouseEvent): void {
  const at = ed.canvas.toGrid(event);
  // With Snap off every press acts as with Alt held: raw positions, no snapping to points or the grid.
  const alt = event.altKey || !ed.snap;
  ed.pointer = { at, shift: event.shiftKey, alt };
  const target = type === "move" ? null : ed.canvas.hit(at);
  update(ed, applyEvent(ed.current, { type, x: at.x, y: at.y, shift: event.shiftKey, alt, mod: event.metaKey || event.ctrlKey, target }, ed.canvas.scale()));
}

/** Records a press; the second of two quick presses at one spot is a double press. The canvas content is rebuilt on every render, so the browser may detach the pressed element and fire no dblclick: the double is detected here instead. */
function notePress(ed: Editor, event: MouseEvent): void {
  const now = Date.now();
  const last = ed.press.last;
  const second = last !== null && now - last.time <= DOUBLE_MS && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= DOUBLE_PX;
  ed.press = { last: second ? null : { time: now, x: event.clientX, y: event.clientY }, second, handled: false };
}

function attachPointer(ed: Editor): void {
  const el = ed.canvas.el;
  el.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) { return; }
    notePress(ed, event);
    event.preventDefault();
    el.focus({ preventScroll: true });
    if ("pointerId" in event && typeof el.setPointerCapture === "function") {
      try { el.setPointerCapture(event.pointerId); } catch { /* capture is a nicety */ }
    }
    pointerEvent(ed, "down", event);
  });
  el.addEventListener("pointermove", (event) => { if (ed.current.draft) { pointerEvent(ed, "move", event); } });
  el.addEventListener("pointerup", (event) => {
    pointerEvent(ed, "up", event);
    if (!ed.press.second) { return; }
    ed.press = { ...ed.press, second: false, handled: true };
    pointerEvent(ed, "dblclick", event);
  });
  el.addEventListener("dblclick", (event) => {
    if (ed.press.handled) { ed.press = { ...ed.press, handled: false }; return; }
    pointerEvent(ed, "dblclick", event);
  });
}

function onKey(ed: Editor, event: KeyboardEvent): void {
  const mod = event.metaKey || event.ctrlKey;
  const lower = event.key.toLowerCase();
  const history = mod && (lower === "z" || lower === "y");
  // Keys typed in the open editor stay in it: the note's ProseMirror never sees them (its ⌘Z would undo the drawing's insert). Other shortcuts (⌘S) still reach the host.
  if (!mod || history) { event.stopPropagation(); }
  const tag = event.target instanceof Element ? event.target.tagName : "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") { return; }
  if (history) {
    event.preventDefault();
    step(ed, event.shiftKey || lower === "y" ? "redo" : "undo");
    return;
  }
  const current = ed.current;
  if (event.key === "Escape") {
    // Esc cancels the gesture, then clears the selection or closes the field; past that it reaches the figure editor.
    if (current.draft || current.selection.size > 0 || current.editingLabel !== null) { event.preventDefault(); event.stopPropagation(); update(ed, applyEvent(current, ESCAPE, ed.canvas.scale())); }
    return;
  }
  const next = applyEvent(current, { type: "key", key: event.key, shift: event.shiftKey, mod }, ed.canvas.scale());
  if (next !== current) {
    event.preventDefault();
    event.stopPropagation();
    update(ed, next);
  }
}

// ---- the canvas the drawing mode drives ----

export interface DrawingCanvas {
  readonly element: HTMLElement;
  readonly state: EditorState;
  /** Labels and expressions that do not parse; the figure is not written while there is one. */
  readonly broken: readonly Broken[];
  canUndo(): boolean;
  canRedo(): boolean;
  setTool(tool: Tool): void;
  /** The style new items get, also applied to the selected items. */
  setStyle(style: DrawingStyle): void;
  setSnap(on: boolean): void;
  select(keys: ReadonlySet<string>): void;
  /** Applies a pure change to the state (grouping, aligning, …) as one undo step. */
  run(change: (state: EditorState, ids: IdSource) => EditorState): void;
  /** Inserts a ready-made shape in the middle of what the canvas shows, selected. */
  insert(template: ShapeTemplate): void;
  /** Replaces the model as one undo step. */
  edit(model: DrawingModel): void;
  undo(): void;
  redo(): void;
  /** The model with an open label field closed as if left. */
  final(): DrawingModel;
  destroy(): void;
}

/** Mounts the canvas in `host`; `onRender` runs after every render, so the mode can follow the state. */
export function mountDrawingCanvas(host: HTMLElement, model: DrawingModel, onRender: (canvas: DrawingCanvas) => void): DrawingCanvas {
  const history = createHistory(createEditorState(model));
  const canvas = createCanvas();
  const root = renderElement("div", { class: "qmd-drawing-editor-root fe-drawing-root" }, canvas.el);
  host.append(root);
  let api!: DrawingCanvas;
  const ed: Editor = { history, current: history.state, closed: false, pointer: null, broken: [], labelField: null, press: { last: null, second: false, handled: false }, snap: true, labels: createLabels(), canvas, root, onRender: () => onRender(api) };
  const session: EditorSession = { get state() { return ed.current; }, root, canvas: canvas.el, get scale() { return canvas.scale(); }, update: (next) => update(ed, next), preview: (next) => preview(ed, next) };
  ed.labelField = createLabelField(session);
  api = {
    element: root,
    get state() { return ed.current; },
    get broken() { return ed.broken; },
    canUndo: () => ed.history.undo() !== ed.history,
    canRedo: () => ed.history.redo() !== ed.history,
    setTool: (tool) => update(ed, { ...ed.current, tool, draft: null }),
    setStyle: (style) => update(ed, restyleSelection({ ...ed.current, style }, style)),
    setSnap: (on) => { ed.snap = on; },
    select: (keys) => update(ed, { ...ed.current, selection: keys, draft: null }),
    run: (change) => {
      const ids = new IdSource(ed.current);
      const next = change(ed.current, ids);
      ids.remember(next);
      update(ed, next);
    },
    insert: (template) => api.run((state, ids) => insertTemplate(state, template, insertPlace(state.model, template, canvas.centre()), ids)),
    edit: (next) => update(ed, { ...ed.current, model: next }),
    undo: () => step(ed, "undo"),
    redo: () => step(ed, "redo"),
    final: () => (ed.current.editingLabel !== null ? applyEvent(ed.current, ESCAPE, ed.canvas.scale()) : ed.current).model,
    destroy: () => { teardown(ed); root.remove(); },
  };
  attachPointer(ed);
  root.addEventListener("keydown", (event) => onKey(ed, event));
  render(ed);
  void loadMath().then((math) => { if (ed.closed) return; ed.labels.setMath(math); render(ed); }, () => { /* labels stay unrendered when MathJax does not load */ });
  return api;
}
